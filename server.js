require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid'); // ✅ ADDED

const app = express();

// ✅ CRITICAL FIX 1: For Render, Nginx, Paystack webhooks
app.set('trust proxy', 1);

app.use(express.json());
app.use(cors());
app.use(express.static('.'));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ DB Connected'))
.catch(err => console.error(err));

// Import Wallet Model
const Wallet = require('./models/Wallet');

// USER SCHEMA
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  fullName: String,
  bvn: String,
  kycTier: { type: Number, default: 1 },
  riskScore: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// TRANSACTION SCHEMA
const transactionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  walletId: String,
  type: String,
  amount: Number,
  currency: { type: String, default: 'NGN' },
  status: String,
  reference: { type: String, unique: true },
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
    if(!req.user) return res.status(401).json({ success: false, message: 'User not found' });
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

// HELPER: Get or Create Wallet
const getWallet = async (userId) => {
  let wallet = await Wallet.findOne({ userId });
  if(!wallet){
    wallet = await Wallet.create({ userId });
  }
  return wallet;
};

// ✅ HEALTH CHECK - FOR RENDER + README
app.get('/api/health', (req, res) => {
  res.json({ status: "OPERATIONAL" });
});

// AUTH ROUTES
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName, bvn } = req.body; // ✅ ADDED BVN
    if (!email ||!password ||!fullName) return res.json({ success: false, message: 'All fields required' });

    const exists = await User.findOne({ email });
    if (exists) return res.json({ success: false, message: 'Email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed, fullName, bvn }); // ✅ SAVE BVN
    await getWallet(user._id);

    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    const wallet = await getWallet(user._id);
    res.json({
      success: true,
      message: `Welcome to CreativePay, ${fullName}! Your global wallet is ready 💞`,
      token,
      user: { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, walletId: wallet.walletId, balances: wallet.getAllBalances() }
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
    const wallet = await getWallet(user._id);
    res.json({
      success: true,
      message: `Welcome back, ${user.fullName}!`,
      token,
      user: { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, walletId: wallet.walletId, balances: wallet.getAllBalances() }
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/user', authMiddleware, async (req, res) => {
  const wallet = await getWallet(req.user._id);
  res.json({ success: true, user: {...req.user.toObject(), walletId: wallet.walletId, balances: wallet.getAllBalances()} });
});

// WALLET ROUTES
app.post('/api/wallet/fund', authMiddleware, async (req, res) => {
  try {
    const { amount, currency = 'NGN' } = req.body;
    if (!amount || amount < 100) return res.json({ success: false, message: 'Minimum 100' });

    const fraud = checkFraud(req.user, amount);
    if (fraud.blocked) return res.json({ success: false, message: fraud.reason });

    const reference = `CPY-FUND-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: req.user.email,
      amount: amount * 100,
      currency: 'NGN',
      reference,
      metadata: { userId: req.user._id, currency },
      callback_url: `${req.headers.origin}/payment-callback`
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });

    await Transaction.create({ userId: req.user._id, type: 'fund', amount, currency, status: 'pending', reference });
    res.json({ success: true, authorization_url: response.data.data.authorization_url }); // ✅ FIXED:.data.data
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.json({ success: false, message: 'Payment init failed' });
  }
});

// PAYMENT CALLBACK
app.get('/payment-callback', async (req, res) => {
  const { reference } = req.query;
  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });

    if (response.data.status === 'success' && response.data.data.status === 'success') { // ✅ FIXED
      const data = response.data.data;
      const amount = data.amount / 100;
      const email = data.customer.email;
      const currency = data.metadata.currency || 'NGN';

      const user = await User.findOne({ email });
      const txn = await Transaction.findOne({ reference });
      const wallet = await getWallet(user._id);

      if (user && txn && txn.status === 'pending') {
        await wallet.addBalance(currency, amount);
        txn.status = 'success';
        txn.walletId = wallet.walletId;
        await txn.save();
        return res.redirect(`/?success=true&amount=${amount}&currency=${currency}`);
      }
    }
    res.redirect('/?success=false');
  } catch (e) {
    console.error(e);
    res.redirect('/?success=false');
  }
});

// TRANSFER
app.post('/api/wallet/transfer', authMiddleware, async (req, res) => {
  try {
    const { recipient, amount, currency = 'NGN', narration = '' } = req.body;
    if (!recipient ||!amount) return res.json({ success: false, message: 'All fields required' });

    const fraud = checkFraud(req.user, amount);
    if (fraud.blocked) return res.json({ success: false, message: fraud.reason });

    const senderWallet = await getWallet(req.user._id);
    const recipientUser = await User.findOne({ $or: [{ email: recipient }] }); // ✅ FIXED
    if (!recipientUser) return res.json({ success: false, message: 'Recipient not found' });
    const recipientWallet = await getWallet(recipientUser._id);

    if (senderWallet.getBalance(currency) < amount) return res.json({ success: false, message: `Insufficient ${currency} balance` });

    await senderWallet.deductBalance(currency, Number(amount));
    await recipientWallet.addBalance(currency, Number(amount));

    const reference = `CPY-TRF-${Date.now()}`;
    await Transaction.create({ userId: req.user._id, walletId: senderWallet.walletId, type: 'transfer_out', amount, currency, status: 'success', reference, metadata: { to: recipient, narration } });
    await Transaction.create({ userId: recipientUser._id, walletId: recipientWallet.walletId, type: 'transfer_in', amount, currency, status: 'success', reference, metadata: { from: req.user.email, narration } });

    res.json({ success: true, message: `${currency} ${amount} sent successfully` });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ CreativePay Running on port ${PORT}`));