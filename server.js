require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('.'));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ DB Connected'))
.catch(err => console.error(err));

// MULTI CURRENCY SUPPORT: NGN, USD, EUR, GBP
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  fullName: String,
  bvn: String,
  kycTier: { type: Number, default: 0 },
  balances: { 
    NGN: { type: Number, default: 0 },
    USD: { type: Number, default: 0 },
    EUR: { type: Number, default: 0 },
    GBP: { type: Number, default: 0 }
  },
  riskScore: { type: Number, default: 0 }, // ANTI-FRAUD
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// TRANSACTION HISTORY + DOUBLE PAYMENT PROTECTION
const transactionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  type: String, // fund, transfer_out, transfer_in, airtime
  amount: Number,
  currency: { type: String, default: 'NGN' },
  status: String, // pending, success, failed
  reference: { type: String, unique: true }, // ANTI-DUPLICATE
  metadata: Object,
  createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

const JWT_SECRET = process.env.JWT_SECRET || 'creativepay_secret_2026';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id);
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// ANTI-FRAUD FUNCTION
const checkFraud = (user, amount) => {
  if (user.riskScore > 50) return { blocked: true, reason: 'Account flagged for review' };
  if (amount > 500000) return { blocked: true, reason: 'Amount exceeds limit. Contact support' };
  return { blocked: false };
};

// AUTH ROUTES WITH WELCOME NOTE
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password ||!fullName) return res.json({ success: false, message: 'All fields required' });

    const exists = await User.findOne({ email });
    if (exists) return res.json({ success: false, message: 'Email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed, fullName });
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ 
      success: true, 
      message: `Welcome to CreativePay, ${fullName}! Your global wallet is ready 💞`, // WELCOME NOTE
      token, 
      user: { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, balances: user.balances } 
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, message: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ 
      success: true, 
      message: `Welcome back, ${user.fullName}!`, // WELCOME BACK NOTE
      token, 
      user: { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, balances: user.balances } 
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/bvn', authMiddleware, async (req, res) => {
  try {
    const { bvn } = req.body;
    if (!bvn || bvn.length!== 11) return res.json({ success: false, message: 'Invalid BVN' });
    req.user.bvn = bvn;
    req.user.kycTier = 1;
    await req.user.save();
    res.json({ success: true, message: 'BVN Verified Successfully', user: req.user });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/user', authMiddleware, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// TRANSACTION HISTORY ROUTE
app.get('/api/transactions', authMiddleware, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, transactions });
});

// WALLET ROUTES
app.post('/api/wallet/fund', authMiddleware, async (req, res) => {
  try {
    const { amount, currency = 'NGN' } = req.body;
    if (!amount || amount < 100) return res.json({ success: false, message: 'Minimum 100 NGN' });

    const fraud = checkFraud(req.user, amount);
    if (fraud.blocked) return res.json({ success: false, message: fraud.reason });

    const reference = `CP_${crypto.randomBytes(8).toString('hex')}`; // DOUBLE PAYMENT PROTECTION

    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: req.user.email,
      amount: amount * 100,
      currency: 'NGN',
      reference,
      callback_url: `${req.headers.origin}/payment-callback`
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });

    await Transaction.create({ userId: req.user._id, type: 'fund', amount, currency, status: 'pending', reference });
    res.json({ success: true, authorization_url: response.data.authorization_url });
  } catch (e) {
    res.json({ success: false, message: 'Payment init failed' });
  }
});

// PAYMENT CALLBACK - VERIFY AND CREDIT
app.get('/payment-callback', async (req, res) => {
  const { reference } = req.query;
  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    
    if (response.data.status === 'success') {
      const email = response.data.data.customer.email;
      const amount = response.data.amount / 100;
      const user = await User.findOne({ email });
      const txn = await Transaction.findOne({ reference });
      
      if (user && txn && txn.status === 'pending') { // DOUBLE PAYMENT CHECK
        user.balances.NGN += amount;
        await user.save();
        txn.status = 'success';
        await txn.save();
      }
    }
    res.redirect('/');
  } catch (e) {
    res.redirect('/');
  }
});

app.post('/api/wallet/transfer', authMiddleware, async (req, res) => {
  try {
    const { email, amount, currency = 'NGN' } = req.body;
    if (!email ||!amount) return res.json({ success: false, message: 'All fields required' });

    const fraud = checkFraud(req.user, amount);
    if (fraud.blocked) return res.json({ success: false, message: fraud.reason });

    const recipient = await User.findOne({ email });
    if (!recipient) return res.json({ success: false, message: 'Recipient not found' });
    if (req.user.balances[currency] < amount) return res.json({ success: false, message: 'Insufficient balance' });

    req.user.balances[currency] -= Number(amount);
    recipient.balances[currency] += Number(amount);
    await req.user.save();
    await recipient.save();

    const reference = `CP_TRF_${crypto.randomBytes(4).toString('hex')}`;
    await Transaction.create({ userId: req.user._id, type: 'transfer_out', amount, currency, status: 'success', reference, metadata: { to: email } });
    await Transaction.create({ userId: recipient._id, type: 'transfer_in', amount, currency, status: 'success', reference, metadata: { from: req.user.email } });

    res.json({ success: true, message: `₦${amount} sent to ${recipient.fullName}` });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/wallet/airtime', authMiddleware, async (req, res) => {
  try {
    const { number, amount, network } = req.body;
    if (!number ||!amount ||!network) return res.json({ success: false, message: 'All fields required' });
    if (req.user.balances.NGN < amount) return res.json({ success: false, message: 'Insufficient balance' });

    req.user.balances.NGN -= Number(amount);
    await req.user.save();
    const reference = `CP_AIR_${crypto.randomBytes(4).toString('hex')}`;
    await Transaction.create({ userId: req.user._id, type: 'airtime', amount, currency: 'NGN', status: 'success', reference, metadata: { number, network } });

    res.json({ success: true, message: `₦${amount} airtime sent to ${number} via ${network}` });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ CreativePay Running on port ${PORT}`));