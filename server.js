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
app.use(express.json());

// ===================
// CORS - FIXED FOR LIVE URL
// ===================
app.use(cors({
  origin: [
    'https://creative-payroll-infrastructure.onrender.com', // ✅ YOUR REAL URL
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Serve frontend
app.use(express.static(path.join(__dirname, '.')));

// Rate limiter
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// DB Connection
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB Database Connected Successfully'))
.catch(err => console.error('❌ DB Connection Error: ', err));

const Wallet = require('./models/Wallet');
const User = require('./models/User');
const Txn = require('./models/Transaction');

// ===================
// AUTH MIDDLEWARE
// ===================
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader ||!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Access Denied: No Token Provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or Expired Token' });
  }
};

// ===================
// REGISTER
// ===================
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email ||!password ||!fullName) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const walletId = 'CP' + crypto.randomBytes(4).toString('hex').toUpperCase();
    
    const user = await User.create({ 
      name: fullName,
      email, 
      password: hashed,
      walletId: walletId
    });

    // Create wallet for new user
    await Wallet.create({ userId: user._id, walletId: walletId });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ 
      success: true, 
      token, 
      user: { id: user._id, name: user.name, email: user.email, walletId: user.walletId, balances: {NGN:0,GHS:0,KES:0,USD:0,EUR:0,GBP:0}, kycTier: user.kycTier } 
    });
  } catch(e) { 
    console.error(e);
    res.status(500).json({ success: false, message: e.message }); 
  }
});

// ===================
// LOGIN
// ===================
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Invalid credentials' });

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
        balances: wallet? wallet.balances : {NGN:0,GHS:0,KES:0,USD:0,EUR:0,GBP:0}, 
        kycTier: user.kycTier 
      } 
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===================
// GET USER + DASHBOARD
// ===================
app.get('/api/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    const wallet = await Wallet.findOne({ userId: req.user.id });
    res.json({ 
      success: true, 
      user, 
      balances: wallet? wallet.balances : {NGN:0,GHS:0,KES:0,USD:0,EUR:0,GBP:0},
      walletId: wallet? wallet.walletId : null
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===================
// FUND WALLET - FIXED TO RETURN AUTH URL
// ===================
app.post('/api/wallet/fund', auth, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ success: false, message: 'Minimum funding is 100' });
    
    const targetCurrency = currency || 'NGN';
    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet missing' });

    // TODO: Replace this with real Paystack integration
    // For now we simulate success and return a fake auth_url
    const authorization_url = `https://checkout.paystack.com/test_${crypto.randomBytes(8).toString('hex')}`;

    res.json({ 
      success: true, 
      authorization_url,
      message: `Redirecting to payment gateway for ${amount} ${targetCurrency}` 
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===================
// SEND MONEY - FIXED TO ACCEPT EMAIL OR WALLETID
// ===================
app.post('/api/wallet/transfer', auth, async (req, res) => {
  try {
    const { recipient, amount, currency, narration } = req.body; // Changed to 'recipient' to match frontend
    if (!recipient ||!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Recipient and amount required' });
    }

    const targetCurrency = currency || 'NGN';
    const senderWallet = await Wallet.findOne({ userId: req.user.id });
    if (!senderWallet) return res.status(404).json({ success: false, message: 'Sender wallet not found' });
    
    // Find recipient by walletId OR email
    const recipientWallet = await Wallet.findOne({ walletId: recipient }) || 
                            await Wallet.findOne().populate({path: 'userId', match: {email: recipient}});
    if (!recipientWallet) return res.status(404).json({ success: false, message: 'Recipient not found' });

    if (senderWallet.walletId === recipientWallet.walletId) {
      return res.status(400).json({ success: false, message: 'Cannot transfer to your own wallet' });
    }

    await Wallet.deductBalance(senderWallet.walletId, targetCurrency, parseFloat(amount));
    await Wallet.addBalance(recipientWallet.walletId, targetCurrency, parseFloat(amount));

    await Txn.create({
      userId: req.user.id,
      walletId: senderWallet.walletId,
      type: 'debit',
      amount: parseFloat(amount),
      currency: targetCurrency,
      description: narration || `Transfer to ${recipient}`
    });

    await Txn.create({
      userId: recipientWallet.userId._id || recipientWallet.userId,
      walletId: recipientWallet.walletId,
      type: 'credit',
      amount: parseFloat(amount),
      currency: targetCurrency,
      description: narration || `Received from ${senderWallet.walletId}`
    });

    res.json({ success: true, message: 'Transfer successful' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===================
// GET TRANSACTIONS
// ===================
app.get('/api/transactions', auth, async (req, res) => {
  try {
    const transactions = await Txn.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, transactions });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});


// Catch all for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server executing securely on production port ${PORT}`));
