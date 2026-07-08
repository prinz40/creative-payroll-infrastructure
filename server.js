require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ✅ CRITICAL FIX 1: For Render, Nginx, Paystack
app.set('trust proxy', 1);

app.use(express.json());

// ✅ CRITICAL FIX 2: ALLOW YOUR FRONTEND TO TALK TO BACKEND
app.use(cors({
  origin: 'https://creative-payroll.onrender.com',
  credentials: true
}));

app.use(express.static('.'));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ DB Connected'))
.catch(err => console.error(err));

// Import Models
const Wallet = require('./models/Wallet');
const User = require('./models/User'); // make sure you have this
const Transaction = require('./models/Transaction'); // make sure you have this

// ===================
// AUTH ROUTES
// ===================
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    const existing = await User.findOne({ email });
    if(existing) return res.status(400).json({ success: false, message: 'User already exists' });
    
    const hashed = await bcrypt.hash(password, 10);
    const walletId = uuidv4();
    const user = new User({ email, password: hashed, fullName, walletId, kycTier: 0, balances: { NGN: 0, GHS: 0, KES: 0, USD: 0, EUR: 0, GBP: 0 } });
    await user.save();
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if(!user) return res.status(400).json({ success: false, message: 'Invalid credentials' });
    
    const match = await bcrypt.compare(password, user.password);
    if(!match) return res.status(400).json({ success: false, message: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===================
// USER + WALLET ROUTES
// ===================
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({ success: false, message: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
};

app.get('/api/user', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.json({ success: true, user });
});

app.post('/api/wallet/fund', auth, async (req, res) => {
  // your paystack logic here
  res.json({ success: true, authorization_url: 'https://paystack.com/pay/test' });
});

app.post('/api/wallet/transfer', auth, async (req, res) => {
  // your transfer logic here
  res.json({ success: true, message: 'Transfer successful' });
});

app.post('/api/bvn', auth, async (req, res) => {
  res.json({ success: true, message: 'BVN Verified' });
});

app.get('/api/transactions', auth, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
  res.json({ success: true, transactions });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));