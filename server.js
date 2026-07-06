const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// 1. ENV VALIDATION
const requiredEnvs = ['PAYSTACK_SECRET_KEY', 'JWT_SECRET', 'MONGODB_URI'];
let missingEnv = false;
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`❌ FATAL: ${env} missing`);
    missingEnv = true;
  }
}
if (!missingEnv) console.log('✅ All environment variables loaded');

// RATES
const RATES = { NGN: 1, GHS: 0.085, KES: 0.85 };

// 2. MIDDLEWARE
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// 3. DATABASE
console.log('🔄 Connecting to MongoDB...');
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000
  })
 .then(() => console.log('✅ MongoDB Connected'))
 .catch(err => { console.error('❌ MongoDB Error:', err.message); });
} else {
  console.error('❌ MONGODB_URI not set. API will run but DB routes will fail.');
}

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

// 5. AUTH MIDDLEWARE
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// 6. HELPER
const buildUserResponse = async (user) => {
  let wallet = await Wallet.findOne({ userId: user._id });
  if (!wallet) wallet = { balances: { NGN: 0, GHS: 0, KES: 0 }, walletId: null, currency: 'NGN' };
  const balances = Object.fromEntries(wallet.balances || new Map([['NGN',0],['GHS',0],['KES',0]]));
  return { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, kycStatus: user.kycStatus, balances, activeCurrency: wallet.currency, walletId: wallet.walletId };
};

// 7. HEALTH CHECK + ROOT
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CreativePay API OPERATIONAL',
    db: mongoose.connection.readyState === 1? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ success: true, message: 'CreativePay API is LIVE 🔥', version: '1.0.0' });
});

// 8. PUBLIC ROUTES
app.get('/api/partners/public', async (req, res) => {
  try {
    // Return empty array for now. Add real partner logic later
    res.json({ success: true, data: [], message: 'Partners endpoint working' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch partners' });
  }
});

// 9. AUTH ROUTES
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password ||!fullName) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'User exists' });
    const user = await User.create({ email, password: await bcrypt.hash(password, 12), fullName });
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, user: await buildUserResponse(user), token });
  } catch (e) {
    console.error('Register:', e.message);
    res.status(500).json({ success: false, message: 'Register failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user ||!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid' });
    }
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: await buildUserResponse(user), token });
  } catch (e) {
    console.error('Login:', e.message);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

app.post('/api/bvn', authMiddleware, async (req, res) => {
  try {
    const { bvn } = req.body;
    if (!bvn ||!/^\d{11}$/.test(bvn)) {
      return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    }
    await User.findByIdAndUpdate(req.user.id, { bvn, kycTier: 1, kycStatus: 'verified' });
    await Wallet.findOneAndUpdate(
      { userId: req.user.id },
      { $setOnInsert: { walletId: `CPY-${Date.now()}-${req.user.id.slice(-4)}`, balances: { NGN: 0, GHS: 0, KES: 0 }}},
      { upsert: true, new: true }
    );
    res.json({ success: true, user: await buildUserResponse(await User.findById(req.user.id)) });
  } catch (e) {
    console.error('BVN:', e.message);
    res.status(500).json({ success: false, message: 'BVN failed' });
  }
});

app.get('/api/user', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, user: await buildUserResponse(user) });
  } catch (e) {
    console.error('User:', e.message);
    res.status(500).json({ success: false, message: 'Failed' });
  }
});

// 10. 404 HANDLER - MUST BE LAST
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`\n🚀 CreativePay API running on http://localhost:${PORT}`);
  console.log(`✅ Ready to accept requests\n`);
});