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

app.set('trust proxy', 1);

// CORS
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SERVE STATIC FILES
app.use(express.static(path.join(__dirname)));

// SEND INDEX.HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// RATE LIMITING
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 150, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many compliance requests. Please attempt again in 15 minutes.' }
});
app.use('/api/', limiter);

// DATABASE
mongoose.connect(process.env.MONGODB_URI)
 .then(() => console.log('✅ Operational Database Cluster Linked Successfully'))
 .catch(err => {
    console.error('❌ Critical Database Connection Error: ', err.message);
    process.exit(1);
  });

const Wallet = require('./models/Wallet');
const User = require('./models/User');
const Txn = require('./models/Transaction');

// AUTH MIDDLEWARE
const auth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader ||!authHeader.startsWith('Bearer ')) {
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

// REGISTER
app.post('/api/register', async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password ||!fullName ||!email.trim() ||!fullName.trim()) {
      return res.status(400).json({ success: false, message: 'All structural fields are required for onboarding' });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An identity record already exists with this email address' });
    }
    const salt = await bcrypt.genSalt(12);
    const hashed = await bcrypt.hash(password, salt);
    const walletId = 'CP' + crypto.randomBytes(4).toString('hex').toUpperCase();

    const user = await User.create({ 
      name: fullName.trim(),
      email: normalizedEmail, 
      password: hashed,
      walletId: walletId
    });

    try {
      await Wallet.create({ 
        userId: user._id, 
        walletId: walletId,
        balances: { NGN: 0, GHS: 0, KES: 0, USD: 0, EUR: 0, GBP: 0 }
      });
    } catch(walletErr) {
      await User.deleteOne({_id: user._id});
      throw walletErr;
    }

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
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'Server error during registration' });
  }
});

// LOGIN
app.post('/api/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email ||!password) {
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
        balances: wallet? wallet.balances : { NGN: 0, GHS: 0, KES: 0, USD: 0, EUR: 0, GBP: 0 }, 
        kycTier: user.kycTier 
      } 
    });
  } catch(e) { 
    next(e);
  }
});

// GET USER
app.get('/api/user', auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User runtime context missing' });
    const wallet = await Wallet.findOne({ userId: req.user.id });
    res.json({ 
      success: true, 
      user, 
      balances: wallet? wallet.balances : { NGN: 0, GHS: 0, KES: 0, USD: 0, EUR: 0, GBP: 0 },
      walletId: wallet? wallet.walletId : null
    });
  } catch (e) { 
    next(e);
  }
});

// NEW: GET TRANSACTIONS - THIS FIXES "COULD NOT LOAD"
app.get('/api/transactions', auth, async (req, res, next) => {
  try {
    const transactions = await Txn.find({ userId: req.user.id }).sort({ date: -1 }).limit(50);
    res.json({ success: true, transactions });
  } catch (e) { 
    next(e);
  }
});

// FUND - FIXED BUG
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

    // FIXED: was missing backticks
    const authorization_url = `https://paystack.com/pay/${crypto.randomBytes(8).toString('hex')}`;

    res.json({ 
      success: true, 
      authorization_url,
      message: `Gateway URL compiled successfully for ${cleanAmount} ${targetCurrency}` 
    });
  } catch (e) { 
    next(e);
  }
});

// TRANSFER
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
    const senderCurrentBalance = senderWallet.balances[targetCurrency] || 0;
    if (senderCurrentBalance < transferAmount) {
      return res.status(400).json({ success: false, message: `Insufficient liquidity to clear ${transferAmount} ${targetCurrency}` });
    }
    await Wallet.deductBalance(senderWallet.walletId, targetCurrency, transferAmount);
    await Wallet.addBalance(recipientWallet.walletId, targetCurrency, transferAmount);
    await Txn.create({
      userId: req.user.id,
      walletId: senderWallet.walletId,
      type: 'debit',
      amount: transferAmount,
      currency: targetCurrency,
      description: narration || `Remittance dispatch to ${recipientWallet.walletId}`
    });
    await Txn.create({
      userId: recipientWallet.userId,
      walletId: recipientWallet.walletId,
      type: 'credit',
      amount: transferAmount,
      currency: targetCurrency,
      description: narration || `Remittance intake from ${senderWallet.walletId}`
    });
    res.json({ success: true, message: 'Settlement execution across rail completed successfully' });
  } catch (e) { 
    next(e);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});