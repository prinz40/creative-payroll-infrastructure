const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const axios = require('axios'); // ADDED FOR PAYSTACK
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// ENV CHECK
const required = ['PAYSTACK_SECRET_KEY', 'JWT_SECRET', 'MONGODB_URI'];
required.forEach(env => { if (!process.env[env]) { console.error(`❌ FATAL: ${env} missing`); process.exit(1); } });
console.log('✅ Env loaded');

// MIDDLEWARE
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
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  bvn: { type: String, default: null },
  kycTier: { type: Number, default: 0 },
  kycStatus: { type: String, default: 'unverified' }
}, { timestamps: true });

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
  walletId: { type: String, unique: true },
  balances: { type: Map, of: Number, default: { NGN: 0, GHS: 0, KES: 0 } },
  currency: { type: String, default: 'NGN' }
});

const User = mongoose.model('User', userSchema, 'users');
const Wallet = mongoose.model('Wallet', walletSchema, 'wallets');

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

// API ROUTES
app.get('/api/health', (req, res) => res.json({ success: true, db: mongoose.connection.readyState === 1? 'connected' : 'disconnected' }));

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password ||!fullName) return res.status(400).json({ success: false, message: 'All fields required' });
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) return res.status(400).json({ success: false, message: 'User already exists' });
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({ email: email.toLowerCase(), password: hashedPassword, fullName });
    await Wallet.create({ userId: user._id, walletId: `CPY-${Date.now()}`, balances: { NGN: 0, GHS: 0, KES: 0 } });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, user: await buildUser(user), token });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user ||!(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: await buildUser(user), token });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/bvn', auth, async (req, res) => {
  try {
    const { bvn } = req.body;
    if (!/^\d{11}$/.test(bvn)) return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    await User.findByIdAndUpdate(req.user.id, { bvn, kycTier: 1, kycStatus: 'verified' });
    await Wallet.findOneAndUpdate({ userId: req.user.id }, { $setOnInsert: { walletId: `CPY-${Date.now()}`, balances: { NGN: 0, GHS: 0, KES: 0 }}}, { upsert: true });
    res.json({ success: true, user: await buildUser(await User.findById(req.user.id)) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false });
    res.json({ success: true, user: await buildUser(user) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===== NEW WALLET ROUTES =====

// 1. FUND WALLET - PAYSTACK
app.post('/api/wallet/fund', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ success: false, message: 'Min amount is ₦100' });
    
    const user = await User.findById(req.user.id);
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: user.email,
      amount: amount * 100, // Paystack uses kobo
      currency: 'NGN',
      metadata: { userId: user._id }
    }, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    
    res.json({ success: true, authorization_url: response.data.data.authorization_url });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 2. TRANSFER MONEY
app.post('/api/wallet/transfer', auth, async (req, res) => {
  try {
    const { email, amount } = req.body;
    const amt = Number(amount);
    if (!email ||!amt || amt < 100) return res.status(400).json({ success: false, message: 'Invalid amount or email' });
    
    const senderWallet = await Wallet.findOne({ userId: req.user.id });
    const recipient = await User.findOne({ email: email.toLowerCase() });
    if (!recipient) return res.status(404).json({ success: false, message: 'Recipient not found' });
    const recipientWallet = await Wallet.findOne({ userId: recipient._id });
    
    if ((senderWallet.balances.get('NGN') || 0) < amt) return res.status(400).json({ success: false, message: 'Insufficient balance' });
    
    senderWallet.balances.set('NGN', (senderWallet.balances.get('NGN') || 0) - amt);
    recipientWallet.balances.set('NGN', (recipientWallet.balances.get('NGN') || 0) + amt);
    
    await senderWallet.save();
    await recipientWallet.save();
    
    res.json({ success: true, message: 'Transfer successful' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 3. BUY AIRTIME
app.post('/api/wallet/airtime', auth, async (req, res) => {
  try {
    const { number, amount, network } = req.body;
    const amt = Number(amount);
    if (!number ||!amt ||!network) return res.status(400).json({ success: false, message: 'All fields required' });
    
    const wallet = await Wallet.findOne({ userId: req.user.id });
    if ((wallet.balances.get('NGN') || 0) < amt) return res.status(400).json({ success: false, message: 'Insufficient balance' });
    
    // TODO: Integrate with VTU API here
    wallet.balances.set('NGN', (wallet.balances.get('NGN') || 0) - amt);
    await wallet.save();
    
    res.json({ success: true, message: `₦${amt} airtime sent to ${number}` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message });
});

// CATCH ALL
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')) });

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));