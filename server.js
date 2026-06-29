require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// === IN-MEMORY DB FOR MVP ===
const DB = { users: [], tx: [] };
const JWT_SECRET = process.env.JWT_SECRET || 'creativepay-dev-secret';
const PORT = process.env.PORT || 3000;

// === AUTH MIDDLEWARE ===
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// === API ROUTES ===
app.post('/api/register', async (req, res) => {
  const { fullName, email, password } = req.body;
  if (DB.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    fullName,
    email,
    password: hash,
    walletId: 'CPY-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
    balances: { NGN: 0, GHS: 0, KES: 0 },
    kycStatus: 'UNVERIFIED',
    kycTier: 0,
    transactions: []
  };
  DB.users.push(user);
  res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = DB.users.find(u => u.email === email);
  if (!user ||!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid login' });
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

app.get('/api/me', auth, (req, res) => {
  const user = DB.users.find(u => u.id === req.user.id);
  const { password,...safeUser } = user;
  res.json(safeUser);
});

app.post('/api/kyc/verify-bvn', auth, (req, res) => {
  const user = DB.users.find(u => u.id === req.user.id);
  const { bvn } = req.body;
  if (!/^\d{11}$/.test(bvn)) return res.status(400).json({ error: 'BVN must be 11 digits' });
  user.kycStatus = 'TIER_1_VERIFIED';
  user.kycTier = 1;
  res.json({ success: true });
});

app.post('/api/wallet/fund', auth, (req, res) => {
  // MOCK: Replace with real Paystack later
  res.json({ authorization_url: 'https://paystack.com/pay/test' });
});

app.post('/api/send', auth, (req, res) => {
  const { recipientWalletId, amount, currency } = req.body;
  const sender = DB.users.find(u => u.id === req.user.id);
  const recipient = DB.users.find(u => u.walletId === recipientWalletId);
  if (!recipient) return res.status(404).json({ error: 'Wallet not found' });
  if (sender.balances[currency] < amount) return res.status(400).json({ error: 'Insufficient balance' });
  sender.balances[currency] -= amount;
  recipient.balances[currency] += amount;
  const tx = { id: uuidv4(), from: sender.walletId, to: recipientWalletId, amount, currency, type: 'debit', desc: `Sent to ${recipientWalletId}`, date: new Date() };
  sender.transactions.push({...tx, type: 'debit' });
  recipient.transactions.push({...tx, type: 'credit' });
  res.json({ success: true });
});

// === SERVE FRONTEND ===
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === BOOT ===
app.listen(PORT, () => console.log(`CreativePay Phase 4D v1.3.6 running on port ${PORT}`));