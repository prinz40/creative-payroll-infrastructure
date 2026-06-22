const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();

// =========================
// 1. ENV VALIDATION
// =========================
if (!process.env.PAYSTACK_SECRET_KEY) {
  console.error('❌ FATAL: PAYSTACK_SECRET_KEY missing in .env');
  process.exit(1);
}

// =========================
// 2. MIDDLEWARE
// =========================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// 3. DATABASE CONNECTION
// =========================
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB Connected - CreativePay Cluster'))
.catch(err => console.error('❌ MongoDB Error:', err));

// =========================
// 4. DATABASE MODELS
// =========================
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  fullName: { type: String, trim: true },
  bvn: { type: String, default: null },
  kycTier: { type: Number, default: 0 },
  kycStatus: { type: String, default: 'unverified', enum: ['unverified', 'pending', 'verified', 'rejected'] }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const Wallet = require('./models/Wallet');

// NEW: Transaction model to prevent double-credit
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reference: { type: String, required: true, unique: true },
  amount: { type: Number, required: true }, // in kobo
  status: { type: String, enum: ['success', 'failed', 'pending'], default: 'pending' },
  type: { type: String, enum: ['credit', 'debit'], default: 'credit' },
  channel: { type: String, default: 'paystack' },
  metadata: { type: Object }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

// =========================
// 5. AUTH MIDDLEWARE
// =========================
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// =========================
// 6. API ROUTES
// =========================

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      fullName,
      kycTier: 0,
      kycStatus: 'unverified'
    });
    await user.save();
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    console.log('✅ User registered:', user.email);
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: { email: user.email, fullName: user.fullName, kycTier: user.kycTier, kycStatus: user.kycStatus, wallet: null },
      token: token
    });
  } catch (error) {
    console.error('❌ Register Error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const wallet = await Wallet.findOne({ userId: user._id });
    console.log('✅ User logged in:', user.email);
    res.json({
      success: true,
      message: 'Login successful',
      user: { email: user.email, fullName: user.fullName, kycTier: user.kycTier, kycStatus: user.kycStatus, wallet: wallet || null },
      token: token
    });
  } catch (error) {
    console.error('❌ Login Error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// BVN VERIFICATION + AUTO-CREATE WALLET
app.post('/api/bvn', authMiddleware, async (req, res) => {
  try {
    const { bvn } = req.body;
    const userId = req.user.id;
    if (!bvn || bvn.length !== 11 || !/^\d+$/.test(bvn)) {
      return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { bvn: bvn, kycTier: 1, kycStatus: 'verified' },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    let wallet = await Wallet.findOne({ userId: user._id });
    if (!wallet) {
      wallet = await Wallet.create({
        userId: user._id,
        walletId: `CPY-${Date.now()}-${user._id.toString().slice(-4)}`,
        balance: 0,
        currency: 'NGN'
      });
      console.log(`✅ Wallet created for: ${user.email}`);
    }
    console.log('✅ BVN Verified for:', user.email);
    res.json({
      success: true,
      message: 'BVN verified successfully',
      user: { email: user.email, fullName: user.fullName, kycTier: user.kycTier, kycStatus: user.kycStatus, wallet: wallet }
    });
  } catch (error) {
    console.error('❌ BVN Error:', error);
    res.status(500).json({ success: false, error: 'BVN verification failed' });
  }
});

// GET CURRENT USER
app.get('/api/user', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const wallet = await Wallet.findOne({ userId: user._id });
    res.json({
      success: true,
      user: { email: user.email, fullName: user.fullName, kycTier: user.kycTier, kycStatus: user.kycStatus, wallet: wallet || null }
    });
  } catch (error) {
    console.error('❌ User Fetch Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

// WALLET BALANCE API
app.get('/api/wallet/balance', authMiddleware, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }
    res.json({ success: true, balance: wallet.balance, walletId: wallet.walletId, currency: wallet.currency });
  } catch (error) {
    console.error('❌ Balance Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch balance' });
  }
});

// NEW: FUND WALLET VERIFY - PHASE 3 SPRINT 1
app.post('/api/fund-wallet/verify', authMiddleware, async (req, res) => {
  try {
    const { reference } = req.body;
    const userId = req.user.id;

    if (!reference) {
      return res.status(400).json({ success: false, message: 'Transaction reference required' });
    }

    console.log(`🔍 Verifying payment: ${reference} for user: ${userId}`);

    // 1. Check if already processed to prevent double-credit
    const existingTxn = await Transaction.findOne({ reference });
    if (existingTxn && existingTxn.status === 'success') {
      const wallet = await Wallet.findOne({ userId });
      return res.json({ 
        success: true, 
        message: 'Transaction already verified', 
        newBalance: wallet.balance,
        amount: existingTxn.amount / 100 
      });
    }

    // 2. Verify with Paystack
    const paystackRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    const { status, amount, currency } = paystackRes.data.data;

    if (status !== 'success') {
      await Transaction.create({ userId, reference, amount, status: 'failed', type: 'credit' });
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    // 3. Credit wallet atomically - amount is in kobo, convert to naira
    const amountNaira = amount / 100;
    const wallet = await Wallet.findOneAndUpdate(
      { userId },
      { $inc: { balance: amountNaira } },
      { new: true, upsert: true }
    );

    // 4. Log transaction
    await Transaction.create({
      userId,
      reference,
      amount,
      status: 'success',
      type: 'credit',
      channel: 'paystack',
      metadata: paystackRes.data.data
    });

    console.log(`✅ Wallet credited: ₦${amountNaira} for ${req.user.email}. New balance: ₦${wallet.balance}`);

    res.json({
      success: true,
      message: 'Wallet funded successfully',
      newBalance: wallet.balance,
      amount: amountNaira,
      reference
    });

  } catch (error) {
    console.error('❌ Verify Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
});

// =========================
// 7. STATIC FILES
// =========================
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// 8. ROOT ROUTE
// =========================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =========================
// 9. CATCH-ALL
// =========================
app.get('*', (req, res) => {
  res.redirect('/');
});

// =========================
// 10. START SERVER
// =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ JWT Secret: ${process.env.JWT_SECRET ? 'Loaded' : 'MISSING'}`);
  console.log(`✅ Paystack Secret: ${process.env.PAYSTACK_SECRET_KEY ? 'Loaded' : 'MISSING'}`);
  console.log(`✅ MongoDB: ${process.env.MONGODB_URI ? 'Connected' : 'MISSING'}`);
  console.log(`🚀 CreativePay Phase 3 server running on port ${PORT}`);
});