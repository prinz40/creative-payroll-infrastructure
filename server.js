const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// ENV VALIDATION
const requiredEnvs = ['PAYSTACK_SECRET_KEY', 'JWT_SECRET', 'MONGODB_URI'];
requiredEnvs.forEach(env => {
  if (!process.env[env]) {
    console.error(`❌ FATAL: ${env} is missing`);
    process.exit(1);
  }
});
console.log('✅ All environment variables loaded');

// RATES
const RATES = { NGN: 1, GHS: 0.085, KES: 0.85 };

// MIDDLEWARE
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// SERVE FRONTEND - KEY FIX TO SHOW LOGIN PAGE
app.use(express.static(path.join(__dirname)));

// DATABASE
console.log('🔄 Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => { console.error('❌ MongoDB Error:', err.message); process.exit(1); });

// MODELS
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
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

// AUTH MIDDLEWARE
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// HELPER
const buildUserResponse = async (user) => {
  let wallet = await Wallet.findOne({ userId: user._id });
  if (!wallet) wallet = { balances: { NGN: 0, GHS: 0, KES: 0 }, walletId: null, currency: 'NGN' };
  const balances = Object.fromEntries(wallet.balances || new Map([['NGN',0],['GHS',0],['KES',0]]));
  return { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, kycStatus: user.kycStatus, balances, activeCurrency: wallet.currency, walletId: wallet.walletId };
};

// API ROUTES
app.get('/api/health', (req, res) => res.status(200).json({ success: true, message: 'CreativePay API OPERATIONAL', db: mongoose.connection.readyState === 1? 'connected' : 'disconnected', timestamp: new Date().toISOString() }));
app.get('/api/partners/public', async (req, res) => { try { res.json({ success: true, data: [] }); } catch (e) { res.status(500).json({ success: false }); } });

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password ||!fullName) return res.status(400).json({ success: false, message: 'All fields required' });
    if (await User.findOne({ email })) return res.status(400).json({ success: false, message: 'User already exists' });
    const user = await User.create({ email, password: await bcrypt.hash(password, 12), fullName });
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, user: await buildUserResponse(user), token });
  } catch (e) { res.status(500).json({ success: false, message: 'Registration failed' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user ||!(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: await buildUserResponse(user), token });
  } catch (e) { res.status(500).json({ success: false, message: 'Login failed' }); }
});

app.post('/api/bvn', authMiddleware, async (req, res) => {
  try {
    const { bvn } = req.body;
    if (!bvn ||!/^\d{11}$/.test(bvn)) return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    await User.findByIdAndUpdate(req.user.id, { bvn, kycTier: 1, kycStatus: 'verified' });
    await Wallet.findOneAndUpdate({ userId: req.user.id }, { $setOnInsert: { walletId: `CPY-${Date.now()}-${req.user.id.slice(-4)}`, balances: { NGN: 0, GHS: 0, KES: 0 }}}, { upsert: true, new: true });
    res.json({ success: true, user: await buildUserResponse(await User.findById(req.user.id)) });
  } catch (e) { res.status(500).json({ success: false, message: 'BVN verification failed' }); }
});

app.get('/api/user', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user: await buildUserResponse(user) });
  } catch (e) { res.status(500).json({ success: false, message: 'Failed' }); }
});

// FRONTEND CATCH ALL - MUST BE LAST
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// START
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(`\n🚀 CreativePay running on port ${PORT}\n`); });