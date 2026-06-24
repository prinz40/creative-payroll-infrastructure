const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// =========================
// 1. ENV VALIDATION
// =========================
const requiredEnvs = ['PAYSTACK_SECRET_KEY', 'JWT_SECRET', 'MONGODB_URI'];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`❌ FATAL: ${env} missing in.env`);
    process.exit(1);
  }
}

// =========================
// 2. MIDDLEWARE
// =========================
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting - 100 requests per 15 mins per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, try again later' }
});
app.use('/api/', limiter);

// Strict rate limit for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts' }
});
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

// =========================
// 3. DATABASE CONNECTION
// =========================
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log('✅ MongoDB Connected - CreativePay Cluster'))
.catch(err => {
  console.error('❌ MongoDB Error:', err);
  process.exit(1);
});

// =========================
// 4. DATABASE MODELS
// =========================
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  password: { type: String, required: true },
  fullName: { type: String, trim: true },
  bvn: { type: String, default: null },
  kycTier: { type: Number, default: 0, min: 0, max: 3 },
  kycStatus: { type: String, default: 'unverified', enum: ['unverified', 'pending', 'verified', 'rejected'] }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Wallet = require('./models/Wallet');

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reference: { type: String, required: true, unique: true, index: true },
  amount: { type: Number, required: true }, // in kobo
  status: { type: String, enum: ['success', 'failed', 'pending'], default: 'pending', index: true },
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
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// =========================
// 6. HELPER: FORMAT USER RESPONSE
// =========================
const formatUserResponse = async (user) => {
  const wallet = await Wallet.findOne({ userId: user._id });
  return {
    email: user.email,
    fullName: user.fullName,
    kycTier: user.kycTier,
    kycStatus: user.kycStatus,
    balance: wallet?.balance || 0,
    walletId: wallet?.walletId || null,
    createdAt: user.createdAt
  };
};

// =========================
// 7. API ROUTES
// =========================

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: email.toLowerCase(),
      password: hashedPassword,
      fullName,
      kycTier: 0,
      kycStatus: 'unverified'
    });
    
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const userData = await formatUserResponse(user);
    
    console.log('✅ User registered:', user.email);
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: userData,
      token
    });
  } catch (error) {
    console.error('❌ Register Error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// LOGIN - ALWAYS FRESH WALLET
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email ||!password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user ||!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const userData = await formatUserResponse(user);
    
    console.log('✅ User logged in:', user.email, 'Balance:', userData.balance);
    res.json({
      success: true,
      message: 'Login successful',
      user: userData,
      token
    });
  } catch (error) {
    console.error('❌ Login Error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// BVN VERIFICATION + AUTO-CREATE WALLET
app.post('/api/bvn', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { bvn } = req.body;
    if (!bvn || bvn.length!== 11 ||!/^\d+$/.test(bvn)) {
      return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    }
    
    await session.withTransaction(async () => {
      const user = await User.findByIdAndUpdate(
        req.user.id,
        { bvn, kycTier: 1, kycStatus: 'verified' },
        { new: true, session }
      );
      if (!user) throw new Error('User not found');
      
      await Wallet.findOneAndUpdate(
        { userId: user._id },
        {
          $setOnInsert: {
            walletId: `CPY-${Date.now()}-${user._id.toString().slice(-4)}`,
            balance: 0,
            currency: 'NGN'
          }
        },
        { upsert: true, new: true, session }
      );
    });
    
    const user = await User.findById(req.user.id);
    const userData = await formatUserResponse(user);
    
    console.log('✅ BVN Verified for:', user.email);
    res.json({
      success: true,
      message: 'BVN verified successfully',
      user: userData
    });
  } catch (error) {
    console.error('❌ BVN Error:', error);
    res.status(500).json({ success: false, message: error.message || 'BVN verification failed' });
  } finally {
    await session.endSession();
  }
});

// GET CURRENT USER
app.get('/api/user', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const userData = await formatUserResponse(user);
    userData.id = user._id; // <- NEW LINE ADDED HERE
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('❌ User Fetch Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

// WALLET BALANCE
app.get('/api/wallet/balance', authMiddleware, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found. Complete KYC first.' });
    }
    res.json({
      success: true,
      balance: wallet.balance,
      walletId: wallet.walletId,
      currency: wallet.currency
    });
  } catch (error) {
    console.error('❌ Balance Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch balance' });
  }
});

// FUND WALLET VERIFY - ATOMIC TRANSACTION
app.post('/api/fund-wallet/verify', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { reference } = req.body;
    const userId = req.user.id;

    if (!reference) {
      return res.status(400).json({ success: false, message: 'Transaction reference required' });
    }

    console.log(`🔍 Verifying payment: ${reference} for user: ${req.user.email}`);

    // Check if already processed
    const existingTxn = await Transaction.findOne({ reference });
    if (existingTxn?.status === 'success') {
      const wallet = await Wallet.findOne({ userId });
      return res.json({
        success: true,
        message: 'Transaction already verified',
        newBalance: wallet.balance,
        amount: existingTxn.amount / 100
      });
    }

    // Verify with Paystack
    const paystackRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { 
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        timeout: 10000 
      }
    );

    const { status, amount, currency } = paystackRes.data.data;
    if (status!== 'success' || currency!== 'NGN') {
      await Transaction.create({ userId, reference, amount: amount || 0, status: 'failed', type: 'credit' });
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    const amountNaira = amount / 100;
    let wallet;

    // ATOMIC TRANSACTION
    await session.withTransaction(async () => {
      wallet = await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: amountNaira } },
        { new: true, upsert: true, session }
      );

      await Transaction.findOneAndUpdate(
        { reference },
        {
          userId,
          reference,
          amount,
          status: 'success',
          type: 'credit',
          channel: 'paystack',
          metadata: paystackRes.data.data
        },
        { upsert: true, new: true, session }
      );
    });

    console.log(`✅ Wallet credited: ₦${amountNaira} for ${req.user.email}. New balance: ₦${wallet.balance}`);

    res.json({
      success: true,
      message: 'Wallet funded successfully!',
      newBalance: wallet.balance,
      amount: amountNaira,
      reference
    });

  } catch (error) {
    console.error('❌ Verify Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  } finally {
    await session.endSession();
  }
});

// =========================
// 8. STATIC FILES
// =========================
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// 9. ROUTES
// =========================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.redirect('/');
});

// =========================
// 10. ERROR HANDLER
// =========================
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// =========================
// 11. START SERVER
// =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ JWT Secret: ${process.env.JWT_SECRET? 'Loaded' : 'MISSING'}`);
  console.log(`✅ Paystack Secret: ${process.env.PAYSTACK_SECRET_KEY? 'Loaded' : 'MISSING'}`);
  console.log(`✅ MongoDB: ${process.env.MONGODB_URI? 'Connected' : 'MISSING'}`);
  console.log(`🚀 CreativePay Phase 3 server running on port ${PORT}`);
});