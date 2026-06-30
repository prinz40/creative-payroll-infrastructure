require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // ONLY 1 bcrypt
const path = require('path'); // ONLY 1 path
const { v4: uuidv4 } = require('uuid'); // ONLY 1 uuid
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === ENV VARS - RENDER WILL READ THESE ===
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'creativepay-dev-secret';
const MONGO_URI = process.env.MONGO_URI; // MUST set this in Render

if (!MONGO_URI) {
  console.error('FATAL: MONGO_URI missing');
  process.exit(1);
}

// === DB CONNECT ===
mongoose.connect(MONGO_URI)
.then(() => console.log('MongoDB Connected'))
.catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// === SCHEMA ===
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  fullName: { type: String, required: true },
  passwordHash: { type: String, required: true },
  walletId: { type: String, unique: true },
  kycStatus: { type: String, default: 'UNVERIFIED' },
  bvn: { type: String },
  balances: { type: Object, default: { NGN: 0, GHS: 0, KES: 0 } },
  transactions: { type: Array, default: [] }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// === AUTH MIDDLEWARE ===
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// === API ROUTES ===
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    if (!fullName ||!email ||!password) return res.status(400).json({ error: 'All fields required' });
    if (await User.findOne({ email })) return res.status(409).json({ error: 'Email exists' });

    const user = new User({
      fullName,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      walletId: 'CPY-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      balances: { NGN: 0, GHS: 0, KES: 0 },
      kycStatus: 'UNVERIFIED',
      transactions: []
    });
    await user.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user ||!(await bcrypt.compare(password, user.passwordHash))) 
      return res.status(401).json({ error: 'Invalid login' });
    
    const token = jwt.sign({ uid: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.uid).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/kyc/verify-bvn', auth, async (req, res) => {
  try {
    const { bvn } = req.body;
    if (!bvn || String(bvn).length!== 11) 
      return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });

    // TEMP GATE: Only this BVN passes. All others = Invalid
    const validTestBVN = '22222'; 
    if (bvn!== validTestBVN) 
      return res.status(400).json({ success: false, message: 'Invalid BVN' });

    const user = await User.findById(req.user.uid);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.bvn = bvn;
    user.kycStatus = 'TIER_2_VERIFIED';
    await user.save();
    
    // CRITICAL: Always return balances so frontend doesn't crash on.NGN
    return res.status(200).json({ 
      success: true, 
      message: 'BVN Verified',
      data: { balances: user.balances }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/wallet/fund', auth, async (req, res) => {
  // TODO: Replace with real Paystack later
  res.json({ authorization_url: 'https://paystack.com/pay/test' });
});

app.post('/api/send', auth, async (req, res) => {
  try {
    const { recipientWalletId, amount, currency = 'NGN' } = req.body;
    const sender = await User.findById(req.user.uid);
    const recipient = await User.findOne({ walletId: recipientWalletId });
    if (!recipient) return res.status(404).json({ error: 'Wallet not found' });
    if (sender.balances[currency] < amount) return res.status(400).json({ error: 'Insufficient balance' });

    sender.balances[currency] -= amount;
    recipient.balances[currency] += amount;
    
    const tx = { id: uuidv4(), from: sender.walletId, to: recipientWalletId, amount, currency, type: 'debit', desc: 'Sent', at: new Date() };
    sender.transactions.push(tx);
    recipient.transactions.push({...tx, type: 'credit' });
    
    await sender.save();
    await recipient.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// === SERVE FRONTEND - FIXED TO index.v4.html ===
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.v4.html')); // <-- FIXED: No more ENOENT
});

// === BOOT ===
app.listen(PORT, () => console.log(`CreativePay 4D v1.6.2 running on port ${PORT}`));
