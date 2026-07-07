require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('.'));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ DB Connected'))
.catch(err => console.error(err));

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  fullName: String,
  bvn: String,
  kycTier: { type: Number, default: 0 },
  balances: { NGN: { type: Number, default: 0 } },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  type: String,
  amount: Number,
  currency: String,
  status: String,
  reference: String,
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

// AUTH ROUTES
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password ||!fullName) return res.json({ success: false, message: 'All fields required' });
    
    const exists = await User.findOne({ email });
    if (exists) return res.json({ success: false, message: 'Email already exists' });
    
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed, fullName });
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ success: true, token, user: { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, balances: user.balances } });
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
    res.json({ success: true, token, user: { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, balances: user.balances } });
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
    res.json({ success: true, user: req.user });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/user', authMiddleware, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// WALLET ROUTES
app.post('/api/wallet/fund', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 100) return res.json({ success: false, message: 'Minimum 100 NGN' });
    
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: req.user.email,
      amount: amount * 100,
      callback_url: `${req.headers.origin}/payment-callback`
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    
    res.json({ success: true, authorization_url: response.data.authorization_url });
  } catch (e) {
    res.json({ success: false, message: 'Payment init failed' });
  }
});

app.post('/api/wallet/transfer', authMiddleware, async (req, res) => {
  try {
    const { email, amount } = req.body;
    if (!email ||!amount) return res.json({ success: false, message: 'All fields required' });
    
    const recipient = await User.findOne({ email });
    if (!recipient) return res.json({ success: false, message: 'Recipient not found' });
    
    if (req.user.balances.NGN < amount) return res.json({ success: false, message: 'Insufficient balance' });
    
    req.user.balances.NGN -= Number(amount);
    recipient.balances.NGN += Number(amount);
    await req.user.save();
    await recipient.save();
    
    await Transaction.create({ userId: req.user._id, type: 'transfer_out', amount, currency: 'NGN', status: 'success' });
    await Transaction.create({ userId: recipient._id, type: 'transfer_in', amount, currency: 'NGN', status: 'success' });
    
    res.json({ success: true, message: 'Transfer successful' });
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
    
    await Transaction.create({ userId: req.user._id, type: 'airtime', amount, currency: 'NGN', status: 'success', metadata: { number, network } });
    
    res.json({ success: true, message: `₦${amount} airtime sent to ${number}` });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));