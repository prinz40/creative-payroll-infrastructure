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
app.set('trust proxy', 1);

// =========================
// 1. ENV VALIDATION
// =========================
const requiredEnvs = ['PAYSTACK_SECRET_KEY', 'JWT_SECRET', 'MONGODB_URI'];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`❌ FATAL: ${env} missing in .env`);
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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts' },
  standardHeaders: true,
  legacyHeaders: false,
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
  amount: { type: Number, required: true },
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
// 6. HELPER: BUILD USER RESPONSE - BULLETPROOF FINAL REMIX
// =========================
const buildUserResponse = async (user) => {
  try {
    // FIX: String matching fallback approach guarantees successful search lookup across native contexts
    const targetUserId = user._id ? user._id.toString() : user.id;
    
    console.log(`🔍 Querying wallet for sanitized userId reference string: ${targetUserId}`);
    let wallet = await Wallet.findOne({ userId: targetUserId });

    if (wallet && (!wallet.walletId || wallet.walletId === '')) {
      console.log('🔧 Dynamic configuration update applied to patch legacy index values');
      wallet.walletId = `CPY-${Date.now()}-${targetUserId.slice(-4)}`;
      await wallet.save();
    }

    let safeBalance = 0;
    if (wallet && wallet.balance !== undefined && wallet.balance !== null) {
      safeBalance = parseFloat(wallet.balance.toString());
      if (isNaN(safeBalance)) safeBalance = 0;
    }

    return {
      id: targetUserId,
      email: user.email,
      fullName: user.fullName,
      kycTier: user.kycTier,
      kycStatus: user.kycStatus,
      balance: safeBalance,
      walletId: wallet ? wallet.walletId : null,
      createdAt: user.createdAt
    };
  } catch (error) {
    console.error('❌ buildUserResponse Error Context Recovery operational:', error);
    return {
      id: user._id ? user._id.toString() : null,
      email: user.email,
      fullName: user.fullName,
      kycTier: user.kycTier || 0,
      kycStatus: user.kycStatus || 'unverified',
      balance: 0,
      walletId: null,
      createdAt: user.createdAt
    };
  }
};

// =========================
// 7. API ROUTES
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

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: email.toLowerCase(),
      password: hashedPassword,
      fullName,
      kycTier: 0,
      kycStatus: 'unverified'
    });

    const token = jwt.sign({ id: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const userData = await buildUserResponse(user);

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

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const userData = await buildUserResponse(user);

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
    if (!bvn || bvn.length !== 11 || !/^\d+$/.test(bvn)) {
      return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    }

    const userObjectId = new mongoose.Types.ObjectId(req.user.id);

    await session.withTransaction(async () => {
      const user = await User.findByIdAndUpdate(
        userObjectId,
        { bvn, kycTier: 1, kycStatus: 'verified' },
        { new: true, session }
      );
      if (!user) throw new Error('User not found');

      await Wallet.findOneAndUpdate(
        { userId: userObjectId },
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

    const user = await User.findById(userObjectId);
    const userData = await buildUserResponse(user);

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
    console.log('🔍 /api/user called for userId:', req.user.id);
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) {
      console.log('❌ User not found in DB');
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userData = await buildUserResponse(user);
    console.log('✅ Final userData sent:', JSON.stringify(userData));
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('❌ User Fetch Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

// WALLET BALANCE
app.get('/api/wallet/balance', authMiddleware, async (req, res) => {
  try {
