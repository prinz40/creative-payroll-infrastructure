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

// ENV CHECK
const required = ['PAYSTACK_SECRET_KEY', 'JWT_SECRET', 'MONGODB_URI'];
required.forEach(env => { if (!process.env[env]) { console.error(`❌ FATAL: ${env} missing`); process.exit(1); } });
console.log('✅ Env loaded');

// MIDDLEWARE - CORS MUST BE FIRST
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// SERVE FRONTEND
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// DB CONNECT
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => { console.error('❌ MongoDB Error:', err.message); process.exit(1); });

// MODELS
const User = mongoose.model('User', new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  bvn: { type: String, default: null },
  kycTier: { type: Number, default: 0 },
  kycStatus: { type: String, default: 'unverified' }
}, { timestamps: true }));

const Wallet = mongoose.model('Wallet', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
  walletId: { type: String, unique: true },
  balances: { type: Map, of: Number, default: { NGN: 0, GHS: 0, KES: 0 } },
  currency: { type: String, default: 'NGN' }
}));

// AUTH MIDDLEWARE
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
};

const buildUser = async (user) => {
  let wallet = await Wallet.findOne({ userId: user._id });
  if (!wallet) wallet = { balances: new Map([['NGN',0],['GHS',0],['KES',0]]), walletId: null, currency: 'NGN' };
  const balances = Object.fromEntries(wallet.balances);
  return { id: user._id, email: user.email, fullName: user.fullName, kycTier: user.kycTier, kycStatus: user.kycStatus, balances, activeCurrency: wallet.currency, walletId: wallet.walletId };
};

// API ROUTES WITH LOGGING
app.get('/api/health', (req, res) => res.json({ success: true, db: mongoose.connection.readyState === 1? 'connected' : 'disconnected' }));

app.post('/api/register', async (req, res) => {
  console.log('📝 Register hit:', req.body.email);
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password ||!fullName) return res.status(400).json({ success: false, message: 'All fields required' });
    if (await User.findOne({ email })) return res.status(400).json({ success: false, message: 'User already exists' });
    const user = await User.create({ email, password: await bcrypt.hash(password, 12), fullName });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    console.log('✅ User created:', email);
    res.status(201).json({ success: true, user: await buildUser(user), token });
  } catch (e) { console.error('Register Error:', e.message); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/login', async (req, res) => {
  console.log('🔑 Login hit:', req.body.email);
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user ||!(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    console.log('✅ Login success:', email);
    res.json({ success: true, user: await buildUser(user), token });
  } catch (e) { console.error('Login Error:', e.message); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/bvn', auth, async (req, res) => {
  try {
    const { bvn } = req.body;
    if (!/^\d{11}$/.test(bvn)) return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    await User.findByIdAndUpdate(req.user.id, { bvn, kycTier: 1, kycStatus: 'verified' });
    await Wallet.findOneAndUpdate({ userId: req.user.id }, { $setOnInsert: { walletId: `CPY-${Date.now()}`, balances: { NGN: 0, GHS: 0, KES: 0 }}}, { upsert: true });
    res.json({ success: true, user: await buildUser(await User.findById(req.user.id)) });
  } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.get('/api/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false });
    res.json({ success: true, user: await buildUser(user) });
  } catch (e) { res.status(500).json({ success: false }); }
});

// CATCH ALL
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));
