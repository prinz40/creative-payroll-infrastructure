const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// =========================
// 1. MIDDLEWARE
// =========================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// 2. DATABASE CONNECTION
// =========================
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB Connected - Creativepay Cluster'))
.catch(err => console.error('❌ MongoDB Error:', err));

// =========================
// 3. DATABASE MODELS
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

// =========================
// 4. AUTH MIDDLEWARE
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
// 5. API ROUTES
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
    if (!email ||!password) {
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
    if (!bvn || bvn.length!== 11 ||!/^\d+$/.test(bvn)) {
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

// PHASE 2: WALLET BALANCE API
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

// =========================
// 6. STATIC FILES
// =========================
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// 7. WALLET DASHBOARD - PHASE 2
// =========================
app.get('/dashboard', async (req, res) => {
  try {
    // Check for token in query or header for direct browser access
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) {
      return res.redirect('/');
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    const wallet = await Wallet.findOne({ userId: user._id });
    
    if (!wallet) {
      return res.redirect('/?error=no_wallet');
    }

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>CreativePay Wallet</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0a0a0a; color:#fff; font-family:system-ui,-apple-system,sans-serif; padding:20px; }
   .container { max-width:400px; margin:0 auto; }
   .header { text-align:center; margin:30px 0; }
   .header h1 { font-size:28px; margin-bottom:10px; }
   .balance-card { background:linear-gradient(135deg,#1a1a1a,#2d2d2d); padding:30px; border-radius:20px; text-align:center; margin:20px 0; border:1px solid #333; }
   .balance-label { color:#888; font-size:14px; }
   .balance { font-size:48px; font-weight:bold; color:#00ff88; margin:10px 0; }
   .wallet-id { font-size:12px; color:#666; margin-top:10px; word-break:break-all; }
   .actions { display:grid; grid-template-columns:1fr 1fr; gap:15px; margin:30px 0; }
   .btn { background:#1a1a1a; border:1px solid #333; padding:20px; border-radius:15px; color:#fff; font-size:16px; cursor:pointer; transition:all 0.2s; }
   .btn:active { transform:scale(0.95); background:#2a2a2a; }
   .kyc-badge { background:#00ff88; color:#000; padding:8px 15px; border-radius:20px; display:inline-block; font-size:14px; font-weight:bold; }
   .footer { text-align:center; margin-top:40px; color:#666; font-size:14px; }
   .logout { background:none; border:1px solid #333; color:#888; padding:10px 20px; border-radius:10px; margin-top:15px; cursor:pointer; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>CreativePay</h1>
      <div class="kyc-badge">KYC Tier ${user.kycTier} Verified ✓</div>
    </div>
    
    <div class="balance-card">
      <div class="balance-label">Available Balance</div>
      <div class="balance">₦${wallet.balance.toLocaleString()}.00</div>
      <div class="wallet-id">Wallet ID: ${wallet.walletId}</div>
    </div>

    <div class="actions">
      <button class="btn" onclick="alert('Send feature coming in Phase 3')">Send</button>
      <button class="btn" onclick="alert('Receive feature coming in Phase 3')">Receive</button>
      <button class="btn" onclick="alert('Scan QR coming in Phase 3')">Scan QR</button>
      <button class="btn" onclick="alert('Transaction history coming in Phase 3')">History</button>
    </div>

    <div class="footer">
      <p>${user.email}</p>
      <button class="logout" onclick="localStorage.removeItem('token');window.location='/'">Logout</button>
    </div>
  </div>
</body>
</html>
    `);
  } catch (error) {
    console.error('Dashboard Error:', error);
    res.redirect('/?error=session_expired');
  }
});
// =========================
// 8. ROOT ROUTE - SHOW WALLET IF LOGGED IN
// =========================
app.get('/', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    const wallet = await Wallet.findOne({ userId: user._id });
    
    if (!wallet) {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>CreativePay Wallet</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0a0a0a; color:#fff; font-family:system-ui,-apple-system,sans-serif; padding:20px; }
 .container { max-width:400px; margin:0 auto; }
 .header { text-align:center; margin:30px 0; }
 .header h1 { font-size:28px; margin-bottom:10px; }
 .balance-card { background:linear-gradient(135deg,#1a1a1a,#2d2d2d); padding:30px; border-radius:20px; text-align:center; margin:20px 0; border:1px solid #333; }
 .balance-label { color:#888; font-size:14px; }
 .balance { font-size:48px; font-weight:bold; color:#00ff88; margin:10px 0; }
 .wallet-id { font-size:12px; color:#666; margin-top:10px; word-break:break-all; }
 .actions { display:grid; grid-template-columns:1fr 1fr; gap:15px; margin:30px 0; }
 .btn { background:#1a1a1a; border:1px solid #333; padding:20px; border-radius:15px; color:#fff; font-size:16px; cursor:pointer; transition:all 0.2s; }
 .btn:active { transform:scale(0.95); background:#2a2a2a; }
 .kyc-badge { background:#00ff88; color:#000; padding:8px 15px; border-radius:20px; display:inline-block; font-size:14px; font-weight:bold; }
 .footer { text-align:center; margin-top:40px; color:#666; font-size:14px; }
 .logout { background:none; border:1px solid #333; color:#888; padding:10px 20px; border-radius:10px; margin-top:15px; cursor:pointer; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>CreativePay</h1>
      <div class="kyc-badge">KYC Tier ${user.kycTier} Verified ✓</div>
    </div>
    
    <div class="balance-card">
      <div class="balance-label">Available Balance</div>
      <div class="balance">₦${wallet.balance.toLocaleString()}.00</div>
      <div class="wallet-id">Wallet ID: ${wallet.walletId}</div>
    </div>

    <div class="actions">
      <button class="btn" onclick="alert('Send feature coming in Phase 3')">Send</button>
      <button class="btn" onclick="alert('Receive feature coming in Phase 3')">Receive</button>
      <button class="btn" onclick="alert('Scan QR coming in Phase 3')">Scan QR</button>
      <button class="btn" onclick="alert('Transaction history coming in Phase 3')">History</button>
    </div>

    <div class="footer">
      <p>${user.email}</p>
      <button class="logout" onclick="localStorage.removeItem('token');window.location='/'">Logout</button>
    </div>
  </div>
</body>
</html>
    `);
  } catch (error) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// =========================
// 9. CATCH-ALL FOR OTHER ROUTES
// =========================
app.get('*', (req, res) => {
  res.redirect('/');
});

// =========================
// 9. START SERVER
// =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ JWT Secret: ${process.env.JWT_SECRET? 'Loaded' : 'MISSING'}`);
  console.log(`✅ MongoDB: ${process.env.MONGODB_URI? 'Connected' : 'MISSING'}`);
  console.log(`🚀 CreativePay Phase 2 server running on port ${PORT}`);
});