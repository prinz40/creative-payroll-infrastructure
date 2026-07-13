require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');

const app = express();

// Trust proxy settings for secure headers over deployment layers (e.g., Render)
app.set('trust proxy', 1);
app.use(express.json());

// ==========================================
// CORS PIPELINE - REINFORCED FOR STABILITY
// ==========================================
app.use(cors({
  origin: [
    'https://creative-payroll-infrastructure.onrender.com',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Static deployment route serving frontend root assets
app.use(express.static(path.join(__dirname, '.')));

// ==========================================
// RATE LIMITING - SAFEGUARD AGAINST DOS/BRUTE
// ==========================================
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, // 15 Minute monitoring windows
  max: 150, // Permitted requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many compliance requests. Please attempt again in 15 minutes.' }
});
app.use('/api/', limiter);

// ==========================================
// DATABASE CONNECTION ENGINE
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Operational Database Cluster Linked Successfully'))
  .catch(err => {
    console.error('❌ Critical Database Connection Error: ', err.message);
    process.exit(1); // Force terminate on database cluster failure
  });

// Schema imports
const Wallet = require('./models/Wallet');
const User = require('./models/User');
const Txn = require('./models/Transaction');

// ==========================================
// AUTHENTICATION INTERCEPTOR MIDDLEWARE
// ==========================================
const auth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access Denied: No Token Signature Provided' });
    }
    const token = authHeader.split(' ')[1];
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Session Expired or Authorization Handshake Invalid' });
  }
};

// ==========================================
// ENDPOINT: USER REGISTRATION PIPELINE
// ==========================================
app.post('/api/register', async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;
    
    // Explicit Validation Check
    if (!email || !password || !fullName || !email.trim() || !fullName.trim()) {
      return res.status(400).json({ success: false, message: 'All structural fields are required for onboarding' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An identity record already exists with this email address' });
    }

    // Security Encryption Tier
    const salt = await bcrypt.genSalt(12);
    const hashed = await bcrypt.hash(password, salt);
    
    // Core Wallet Core Identity generation
    const walletId = 'CP' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // Persist User profile to Core engine
    const user = await User.create({ 
      name: fullName.trim(),
      email: normalizedEmail, 
      password: hashed,
      walletId: walletId
    });

    // Provision clean multicurrency wallet mapping record
    await Wallet.create({ 
      userId: user._id, 
      walletId: walletId,
      balances: { NGN: 0, GHS: 0, KES: 0, USD: 0, EUR: 0, GBP: 0 }
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({ 
      success: true, 
      token, 
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        walletId: user.walletId, 
        balances: { NGN: 0, GHS: 0, KES: 0, USD: 0, EUR: 0, GBP: 0 }, 
        kycTier: user.kycTier || 'Unverified'
      } 
    });
  } catch(e) { 
    next(e);
  }
});

// ==========================================
// ENDPOINT: ACCOUNT VALIDATION / LOGIN
// ==========================================
app.post('/api/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password profiles must be supplied' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid authentication credentials provided' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Invalid authentication credentials provided' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const wallet = await Wallet.findOne({ userId: user._id });

    res.json({ 
      success: true, 
      token, 
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        walletId: user.walletId, 
        balances: wallet ? wallet.balances : { NGN: 0, GHS: 0, KES: 0, USD: 0, EUR: 0, GBP: 0 }, 
        kycTier: user.kycTier 
      } 
    });
  } catch(e) { 
    next(e);
  }
});

// ==========================================
// ENDPOINT: FETCH PROFILE & LEDGERS
// ==========================================
app.get('/api/user', auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User runtime context missing' });

    const wallet = await Wallet.findOne({ userId: req.user.id });
    res.json({ 
      success: true, 
      user, 
      balances: wallet ? wallet.balances : { NGN: 0, GHS: 0, KES: 0, USD: 0, EUR: 0, GBP: 0 },
      walletId: wallet ? wallet.walletId : null
    });
  } catch (e) { 
    next(e);
  }
});

// ==========================================
// ENDPOINT: LIQUIDITY INJECTION / INITIALIZE DEPOSIT
// ==========================================
app.post('/api/wallet/fund', auth, async (req, res, next) => {
  try {
    const { amount, currency } = req.body;
    const cleanAmount = parseFloat(amount);
    
    if (isNaN(cleanAmount) || cleanAmount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum funding threshold is 100 units' });
    }

    const targetCurrency = (currency || 'NGN').toUpperCase();
    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) return res.status(404).json({ success: false, message: 'User wallet record allocation missing' });

    // Paystack infrastructure secure routing reference mock
    const authorization_url = `https://checkout.paystack.com/test_${crypto.randomBytes(8).toString('hex')}`;

    res.json({ 
      success: true, 
      authorization_url,
      message: `Gateway URL compiled successfully for ${cleanAmount} ${targetCurrency}` 
    });
  } catch (e) { 
    next(e);
  }
});

// ==========================================
// ENDPOINT: CROSS-BORDER WIRE TRANSACTIONS (FIXED)
// ==========================================
app.post('/api/wallet/transfer', auth, async (req, res, next) => {
  try {
    const { recipient, amount, currency, narration } = req.body; 
    const transferAmount = parseFloat(amount);

    if (!recipient || isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid parsing parameters for recipient and transaction amounts required' });
    }

    const targetCurrency = (currency || 'NGN').toUpperCase();
    const senderWallet = await Wallet.findOne({ userId: req.user.id });
    if (!senderWallet) return res.status(404).json({ success: false, message: 'Sender processing ledger node not found' });

    // SAFE CORRECTION RULE FOR THE BUG: Look up by walletId first; if failure, find user account entity
    let recipientWallet = await Wallet.findOne({ walletId: recipient.trim().toUpperCase() });
    
    if (!recipientWallet) {
      const recipientUser = await User.findOne({ email: recipient.toLowerCase().trim() });
      if (recipientUser) {
        recipientWallet = await Wallet.findOne({ userId: recipientUser._id });
      }
    }

    if (!recipientWallet) {
      return res.status(404).json({ success: false, message: 'Target profile account or settlement wallet not discovered' });
    }

    if (senderWallet.walletId === recipientWallet.walletId) {
      return res.status(400).json({ success: false, message: 'Self-targeted routing is restricted on core rails' });
    }

    // Verify sufficient liquidity before triggering schema functions
    const senderCurrentBalance = senderWallet.balances.get ? senderWallet.balances.get(targetCurrency) : senderWallet.balances[targetCurrency];
    if (senderCurrentBalance < transferAmount) {
      return res.status(400).json({ success: false, message: `Insufficient liquidity to clear ${transferAmount} ${targetCurrency}` });
    }

    // Atomic execution updates inside ledger mappings
    await Wallet.deductBalance(senderWallet.walletId, targetCurrency, transferAmount);
    await Wallet.addBalance(recipientWallet.walletId, targetCurrency, transferAmount);

    // Write persistent transaction records
    await Txn.create({
