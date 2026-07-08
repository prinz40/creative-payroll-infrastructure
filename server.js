require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();

// Set trust proxy configuration for proper operation behind Render's Nginx layer
app.set('trust proxy', 1);

app.use(express.json());

// Enable CORS cleanly to allow API access securely
app.use(cors({
  origin: ['https://creative-payroll.onrender.com', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.static('.'));

// Setup global rate limiter to counter script attacks on endpoints
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Establish database connection
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB Database Connected Successfully'))
.catch(err => console.error('❌ DB Connection Error: ', err));


// Import Models
const Wallet = require('./models/Wallet');
const User = require('./User');
const Transaction = require('./Transaction');



// ===================
// MIDDLEWARES
// ===================
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
// AUTH ROUTES
// ===================
app.post('/api/register', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: 'All registration fields are required' });
    }

    const existing = await User.findOne({ email }).session(session);
    if (existing) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    
    // Save to cleaned up User model
    const [user] = await User.create([{ name, email, password: hashed }], { session });

    // Create the associated multi-currency wallet safely within transaction scope
    const wallet = await Wallet.create([{ userId: user._id }], { session });

    await session.commitTransaction();
    session.endSession();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({ 
      success: true, 
      token, 
      user: { id: user._id, name: user.name, email: user.email } 
    });
  } catch(e) { 
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: e.message }); 
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ 
      success: true, 
      token, 
      user: { id: user._id, name: user.name, email: user.email, role: user.role } 
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===================
// USER + WALLET ROUTES
// ===================
app.get('/api/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    const wallet = await Wallet.findOne({ userId: req.user.id });
    
    res.json({ 
      success: true, 
      user, 
      balances: wallet ? wallet.getAllBalances() : {},
      walletId: wallet ? wallet.walletId : null
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/wallet/fund', auth, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });
    
    const targetCurrency = currency || 'NGN';
    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet records missing' });

    // Atomic upgrade integration for currency mutations
    await Wallet.addBalance(wallet.walletId, targetCurrency, parseFloat(amount));

    await Transaction.create({
      userId: req.user.id,
      walletId: wallet.walletId,
      type: 'credit',
      amount: parseFloat(amount),
      currency: targetCurrency,
      description: `Wallet funded via API transaction`
    });

    res.json({ success: true, message: `Successfully funded wallet with ${amount} ${targetCurrency}` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/wallet/transfer', auth, async (req, res) => {
  try {
    const { recipientWalletId, amount, currency } = req.body;
    if (!recipientWalletId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid transfer payload' });
    }

    const targetCurrency = currency || 'NGN';
    const senderWallet = await Wallet.findOne({ userId: req.user.id });
    if (!senderWallet) return res.status(404).json({ success: false, message: 'Sender wallet not found' });
    
    const recipientWallet = await Wallet.findOne({ walletId: recipientWalletId });
    if (!recipientWallet) return res.status(404).json({ success: false, message: 'Recipient wallet not found' });

    if (senderWallet.walletId === recipientWallet.walletId) {
      return res.status(400).json({ success: false, message: 'Cannot transfer funds to your own wallet' });
    }

    // Atomic debit execution
    await Wallet.deductBalance(senderWallet.walletId, targetCurrency, parseFloat(amount));
    // Atomic credit execution
    await Wallet.addBalance(recipientWallet.walletId, targetCurrency, parseFloat(amount));

    // Log tracking for sender
    await Transaction.create({
      userId: req.user.id,
      walletId: senderWallet.walletId,
      type: 'debit',
      amount: parseFloat(amount),
      currency: targetCurrency,
      description: `Transfer to account: ${recipientWalletId}`
    });

    // Log tracking for receiver
    await Transaction.create({
      userId: recipientWallet.userId,
      walletId: recipientWallet.walletId,
      type: 'credit',
      amount: parseFloat(amount),
      currency: targetCurrency,
      description: `Received transfer from account: ${senderWallet.walletId}`
    });

    res.json({ success: true, message: 'Multi-currency transfer processed successfully' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/transactions', auth, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, transactions });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server executing securely on production port ${PORT}`));
