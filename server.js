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

// 1. ENV VALIDATION
const requiredEnvs = ['PAYSTACK_SECRET_KEY', 'JWT_SECRET', 'MONGODB_URI'];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`❌ FATAL: ${env} missing in .env`);
    process.exit(1);
  }
}

// RATES for MVP
const RATES = { NGN: 1, GHS: 0.085, KES: 0.85 };

// 2. MIDDLEWARE
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { success: false, message: 'Too many requests' } });
app.use('/api/', limiter);

// 3. DATABASE
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => { console.error('❌ MongoDB Error:', err); process.exit(1); });

// 4. MODELS
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  fullName: { type: String },
  bvn: { type: String, default: null },
  kycTier: { type: Number, default: 0 },
  kycStatus: { type: String, default: 'unverified' }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
  walletId: { type: String, unique: true },
  balances: { type: Map, of: Number, default: { NGN: 0, GHS: 0, KES: 0 } },
  currency: { type: String, default: 'NGN' }
});
const Wallet = mongoose.model('Wallet', walletSchema);

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reference: { type: String, required: true, unique: true },
  amount: { type: Number },
  amountNGN: { type: Number },
  status: { type: String, enum: ['success', 'failed', 'pending'], default: 'pending' },
  type: { type: String, enum: ['credit', 'debit', 'transfer'] },
  currency: { type: String, default: 'NGN' },
  metadata: { type: Object }
}, { timestamps: true });
const Transaction = mongoose.model('Transaction', transactionSchema);

// 5. AUTH
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
};

// 6. HELPER
const buildUserResponse = async (user) => {
  let wallet = await Wallet.findOne({ userId: user._id });
  if (!wallet) wallet = { balances: { NGN: 0, GHS: 0, KES: 0 }, walletId: null, currency: 'NGN' };
  const balances = Object.fromEntries(wallet.balances || new Map([['NGN',0],['GHS',0],['KES',0]]));
  return { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, kycStatus: user.kycStatus, balances, activeCurrency: wallet.currency, walletId: wallet.walletId };
};

// 7. ROUTES - PHASE 4B
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (await User.findOne({ email })) return res.status(400).json({ success: false, message: 'User exists' });
    const user = await User.create({ email, password: await bcrypt.hash(password, 12), fullName });
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, user: await buildUserResponse(user), token });
  } catch (e) { res.status(500).json({ success: false, message: 'Register failed' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user ||!(await bcrypt.compare(req.body.password, user.password))) return res.status(401).json({ success: false, message: 'Invalid' });
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: await buildUserResponse(user), token });
  } catch (e) { res.status(500).json({ success: false, message: 'Login failed' }); }
});

// ✅ CRITICAL FIX: Endpoint is /api/bvn NOT /api/kyc/verify-bvn
app.post('/api/bvn', authMiddleware, async (req, res) => {
  try {
    const { bvn } = req.body;
    if (!/^\d{11}$/.test(bvn)) return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    await User.findByIdAndUpdate(req.user.id, { bvn, kycTier: 1, kycStatus: 'verified' });
    await Wallet.findOneAndUpdate({ userId: req.user.id }, { $setOnInsert: { walletId: `CPY-${Date.now()}-${req.user.id.slice(-4)}`, balances: { NGN: 0, GHS: 0, KES: 0 } } }, { upsert: true, new: true });
    res.json({ success: true, user: await buildUserResponse(await User.findById(req.user.id)) });
  } catch (e) { res.status(500).json({ success: false, message: 'BVN failed' }); }
});

app.get('/api/user', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.json({ success: true, user: await buildUserResponse(user) });
});

// ✅ CRITICAL FIX: Serve index.html (not index.v4.html)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Phase 4B Compatible server on ${PORT}`));