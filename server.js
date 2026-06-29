require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const MONGO_URI = process.env.MONGO_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`;

if (!PAYSTACK_SECRET ||!MONGO_URI) { 
  console.error('FATAL: PAYSTACK_SECRET_KEY or MONGO_URI missing'); 
  process.exit(1); 
}

mongoose.connect(MONGO_URI)
.then(() => console.log('✅ MongoDB: Connected'))
.catch(err => { 
    console.error('❌ MongoDB connection error:', err); 
    process.exit(1); 
});

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  fullName: { type: String, required: true },
  passwordHash: { type: String, required: true },
  walletId: { type: String, unique: true, required: true },
  kycStatus: { type: String, default: 'UNVERIFIED', enum: ['UNVERIFIED', 'TIER_1_VERIFIED'] },
  balances: { type: Object, default: { NGN: 0, GHS: 0, KES: 0 } },
  transactions: { type: Array, default: [] }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { 
    req.user = jwt.verify(token, JWT_SECRET); 
    next(); 
  } catch { 
    return res.status(401).json({ error: 'Invalid or expired token' }); 
  }
};

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/', (req, res) => {
  res.json({ status: 'LIVE', message: 'CreativePay API Phase 4D', version: 'v1.3.1' });
});

app.post('/api/register', asyncHandler(async (req, res) => {
  const { email, fullName, password } = req.body;
  if (!email ||!fullName ||!password) return res.status(400).json({ error: 'All fields required' });
  if (await User.findOne({ email })) return res.status(400).json({ error: 'Email already registered' });
  const walletId = `CPY-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const user = await User.create({ email, fullName, passwordHash: await bcrypt.hash(password, 10), walletId });
  res.status(201).json({ message: 'Registered successfully', walletId });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user ||!(await bcrypt.compare(password, user.passwordHash))) 
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user._id, kycStatus: user.kycStatus }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, walletId: user.walletId, balances: user.balances, kycStatus: user.kycStatus });
}));

app.get('/api/me', auth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash');
  res.json(user);
}));

app.post('/api/kyc/verify-bvn', auth, asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user.id, { kycStatus: 'TIER_1_VERIFIED' }, { new: true });
  res.json({ message: 'KYC Tier 1 Verified', kycStatus: user.kycStatus });
}));

app.post('/api/wallet/fund', auth, asyncHandler(async (req, res) => {
  const { currency } = req.body;
  const user = await User.findById(req.user.id);
  const amount = currency === 'NGN'? 10000 : currency === 'GHS'? 10005 : 10030;
  const reference = `cpy_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
  const response = await axios.post(
    'https://api.paystack.co/transaction/initialize', 
    { email: user.email, amount, currency, reference, callback_url: `${FRONTEND_URL}/verify.html?ref=${reference}` }, 
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
  );
  res.json({ authorization_url: response.data.authorization_url, reference }); // FIXED:.data.data
}));

app.get('/api/wallet/verify/:reference', auth, asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const user = await User.findById(req.user.id);
  const verify = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
  const data = verify.data;
  if (data.status!== 'success') return res.status(400).json({ error: 'Payment not successful' });
  const currency = data.currency;
  const amount = data.amount / 100;
  user.balances[currency] = (user.balances[currency] || 0) + amount;
  user.transactions.push({ type: 'credit', currency, amount, desc: 'Wallet Funding', date: new Date() });
  await user.save();
  res.json({ message: `Wallet funded: ${currency} ${amount}`, balances: user.balances });
}));

app.post('/api/send', auth, asyncHandler(async (req, res) => {
  const { recipientWalletId, amount, currency } = req.body;
  if (req.user.kycStatus!== 'TIER_1_VERIFIED') return res.status(403).json({ error: 'KYC required' });
  const sender = await User.findById(req.user.id);
  const receiver = await User.findOne({ walletId: recipientWalletId });
  if (!receiver) return res.status(404).json({ error: 'Recipient not found' });
  if ((sender.balances[currency] || 0) < amount) return res.status(400).json({ error: 'Insufficient balance' });
  sender.balances[currency] -= amount;
  receiver.balances[currency] = (receiver.balances[currency] || 0) + amount;
  sender.transactions.push({ type: 'debit', currency, amount, desc: `To ${receiver.email}`, date: new Date() });
  receiver.transactions.push({ type: 'credit', currency, amount, desc: `From ${sender.email}`, date: new Date() });
  await sender.save(); await receiver.save();
  res.json({ message: `${currency} ${amount} sent`, balances: sender.balances });
}));

app.get('/api/banks', auth, asyncHandler(async (req, res) => {
  const { currency } = req.query;
  if (currency!== 'NGN') return res.json({ banks: [] });
  const response = await axios.get('https://api.paystack.co/bank', { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
  res.json({ banks: response.data.filter(b => b.active).map(b => ({ name: b.name, code: b.code })) });
}));

app.post('/api/withdraw', auth, asyncHandler(async (req, res) => {
  const { accountNumber, bankCode, amount, currency } = req.body;
  if (currency!== 'NGN') return res.status(400).json({ error: 'Withdrawals only supported for NGN' });
  const user = await User.findById(req.user.id);
  if ((user.balances.NGN || 0) < amount) return res.status(400).json({ error: 'Insufficient NGN balance' });
  const recipientRes = await axios.post('https://api.paystack.co/transferrecipient', 
    { type: 'nuban', name: user.fullName, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' }, 
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
  );
  const transferRes = await axios.post('https://api.paystack.co/transfer', 
    { source: 'balance', amount: amount * 100, recipient: recipientRes.data.recipient_code, reason: 'CreativePay Withdrawal' }, // FIXED:.data.data
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
  );
  if (transferRes.data.status!== 'success' && transferRes.data.status!== 'pending') // FIXED:.data.data
    return res.status(400).json({ error: 'Transfer failed' });
  user.balances.NGN -= amount;
  user.transactions.push({ type: 'debit', currency: 'NGN', amount, desc: `Withdrawal to ${accountNumber}`, date: new Date() });
  await user.save();
  res.json({ message: `NGN ${amount} withdrawal initiated`, status: transferRes.data.status, balances: user.balances }); // FIXED:.data.data
}));

app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  res.status(500).json({ error: 'Server error. Please try again.' });
});
app.listen(PORT, () => console.log(`🚀 CreativePay Phase 4D v1.3.1 server running on port ${PORT}`));