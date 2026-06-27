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
    console.error(`❌ FATAL: ${env} missing in.env`);
    process.exit(1);
  }
}

// HARDCODED RATES FOR MVP - Phase 4B
const RATES = { 
  NGN: 1, 
  GHS: 0.085, // ₦100 = GHS 8.5
  KES: 0.85 // ₦100 = KES 85
};

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

// PHASE 4B: UPGRADED TRANSACTION SCHEMA - Multi-currency
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  reference: { type: String, required: true, unique: true, index: true },
  amount: { type: Number, required: true },
  amountNGN: { type: Number, required: true }, // Store base NGN for records
  status: { type: String, enum: ['success', 'failed', 'pending'], default: 'pending', index: true },
  type: { type: String, enum: ['credit', 'debit', 'transfer', 'withdraw'], required: true },
  currency: { type: String, default: 'NGN', enum: ['NGN', 'GHS', 'KES'] },
  channel: { type: String, default: 'paystack' },
  description: { type: String },
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
// 6. HELPER: BUILD USER RESPONSE - 4B UPGRADE
// =========================
const buildUserResponse = async (user) => {
  try {
    const userObjectId = new mongoose.Types.ObjectId(user._id);
    let wallet = await Wallet.findOne({ userId: userObjectId });

    if (wallet && (!wallet.walletId || wallet.walletId === '')) {
      wallet.walletId = `CPY-${Date.now()}-${user._id.toString().slice(-4)}`;
      await wallet.save();
    }

    // Convert Map to Object for JSON
    const balances = wallet?.balances? Object.fromEntries(wallet.balances) : { NGN: 0 };
    const activeCurrency = wallet?.currency || 'NGN';

    return {
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      kycTier: user.kycTier,
      kycStatus: user.kycStatus,
      balances, // { NGN: 650, GHS: 0, KES: 0 }
      activeCurrency,
      walletId: wallet?.walletId || null,
      createdAt: user.createdAt
    };
  } catch (error) {
    console.error('❌ buildUserResponse Error:', error);
    return {
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      kycTier: user.kycTier,
      kycStatus: user.kycStatus,
      balances: { NGN: 0 },
      activeCurrency: 'NGN',
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
    const userData = await buildUserResponse(user);

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
    if (!email ||!password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user ||!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const userData = await buildUserResponse(user);

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
            balances: { NGN: 0 },
            currency: 'NGN'
          }
        },
        { upsert: true, new: true, session }
      );
    });

    const user = await User.findById(userObjectId);
    const userData = await buildUserResponse(user);

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
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const user = await User.findById(userObjectId).select('-password').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userData = await buildUserResponse(user);
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('❌ User Fetch Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

// WALLET BALANCE - 4B UPGRADE: Returns all currencies
app.get('/api/wallet/balance', authMiddleware, async (req, res) => {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const wallet = await Wallet.findOne({ userId: userObjectId }).lean();
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found. Complete KYC first.' });
    }
    const balances = wallet.balances? Object.fromEntries(wallet.balances) : { NGN: 0 };
    res.json({
      success: true,
      balances, // { NGN: 650, GHS: 0, KES: 0 }
      activeCurrency: wallet.currency || 'NGN',
      walletId: wallet.walletId
    });
  } catch (error) {
    console.error('❌ Balance Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch balance' });
  }
});

// FUND WALLET VERIFY - 4B UPGRADE: Accepts currency
app.post('/api/fund-wallet/verify', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { reference, currency = 'NGN' } = req.body; // Frontend sends currency
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);

    if (!reference) {
      return res.status(400).json({ success: false, message: 'Transaction reference required' });
    }
    if (!['NGN', 'GHS', 'KES'].includes(currency)) {
      return res.status(400).json({ success: false, message: 'Invalid currency' });
    }

    const existingTxn = await Transaction.findOne({ reference });
    if (existingTxn?.status === 'success') {
      const wallet = await Wallet.findOne({ userId: userObjectId }).lean();
      return res.json({
        success: true,
        message: 'Transaction already verified',
        balances: wallet?.balances? Object.fromEntries(wallet.balances) : { NGN: 0 },
        amount: existingTxn.amount
      });
    }

    const paystackRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        timeout: 10000
      }
    );

    const { status, amount } = paystackRes.data;
    if (status!== 'success') {
      await Transaction.create({ userId: userObjectId, reference, amount: amount || 0, amountNGN: 0, status: 'failed', type: 'credit', currency });
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    const amountNGN = amount / 100; // Paystack is always NGN
    const amountInCurrency = parseFloat((amountNGN * RATES[currency]).toFixed(2));

    let wallet;
    await session.withTransaction(async () => {
      wallet = await Wallet.findOne({ userId: userObjectId }).session(session);
      if (!wallet) throw new Error('Wallet not found');
      
      await wallet.addBalance(currency, amountInCurrency); // Use new helper

      await Transaction.findOneAndUpdate(
        { reference },
        {
          userId: userObjectId,
          reference,
          amount: amountInCurrency,
          amountNGN,
          status: 'success',
          type: 'credit',
          currency,
          channel: 'paystack',
          metadata: paystackRes.data
        },
        { upsert: true, new: true, session }
      );
    });

    res.json({
      success: true,
      message: `Wallet funded successfully! ${currency} ${amountInCurrency}`,
      balances: Object.fromEntries(wallet.balances),
      amount: amountInCurrency,
      currency,
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
// PHASE 4A: SEND MONEY - P2P TRANSFERS
// =========================
app.post('/api/transfer', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { recipient, amount, description, currency = 'NGN' } = req.body;
    const senderId = new mongoose.Types.ObjectId(req.user.id);

    if (!recipient ||!amount || Number(amount) < 10) {
      throw new Error('Recipient and minimum 10 required');
    }

    const transferAmount = Number(amount);

    const sender = await User.findById(senderId).session(session);
    const senderWallet = await Wallet.findOne({ userId: senderId }).session(session);

    if (!sender) throw new Error('Sender not found');
    if (!senderWallet) throw new Error('Sender wallet not found. Complete KYC first');
    if (senderWallet.getBalance(currency) < transferAmount) throw new Error('Insufficient balance');
    if (sender.kycTier < 1) throw new Error('Complete BVN verification to send money');

    let receiver;
    if (recipient.startsWith('CPY-')) {
      const receiverWallet = await Wallet.findOne({ walletId: recipient }).session(session);
      if (!receiverWallet) throw new Error('Recipient wallet not found');
      receiver = await User.findById(receiverWallet.userId).session(session);
    } else {
      receiver = await User.findOne({ email: recipient.toLowerCase() }).session(session);
    }

    if (!receiver) throw new Error('Recipient not found');
    if (receiver._id.equals(sender._id)) throw new Error('Cannot send to yourself');

    const receiverWallet = await Wallet.findOne({ userId: receiver._id }).session(session);
    if (!receiverWallet) throw new Error('Recipient has not completed KYC');

    // Update balances using helpers
    senderWallet.balances.set(currency, senderWallet.getBalance(currency) - transferAmount);
    receiverWallet.balances.set(currency, receiverWallet.getBalance(currency) + transferAmount);

    await senderWallet.save({ session });
    await receiverWallet.save({ session });

    const txRef = 'CPY-TRF-' + Date.now() + '-' + sender._id.toString().slice(-4);
    await Transaction.create([{
      reference: txRef,
      senderId: sender._id,
      receiverId: receiver._id,
      amount: transferAmount,
      amountNGN: transferAmount / RATES[currency],
      type: 'transfer',
      currency,
      status: 'success',
      description: description || `Transfer to ${receiver.email}`
    }], { session });

    await session.commitTransaction();

    res.json({ 
      success: true, 
      message: `${currency} ${transferAmount} sent successfully to ${receiver.email}`,
      balances: Object.fromEntries(senderWallet.balances),
      reference: txRef
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Transfer Error:', error);
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
});

// =========================
// PHASE 4A: TRANSACTION HISTORY
// =========================
app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const transactions = await Transaction.find({
      $or: [
        { senderId: userId }, 
        { receiverId: userId },
        { userId: userId }
      ]
    })
  .populate('senderId', 'email walletId fullName')
  .populate('receiverId', 'email walletId fullName')
  .sort({ createdAt: -1 })
  .limit(50);

    res.json({ success: true, transactions });
  } catch (error) {
    console.error('❌ Transactions Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
});

// =========================
// 8. STATIC FILES - FIXED
// =========================
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// 9. ROUTES - FIXED: Serve files, don't redirect
// =========================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
  console.log(`🚀 CreativePay Phase 4B server running on port ${PORT}`);
});