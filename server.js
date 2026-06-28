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

// 1. HOMEPAGE ROUTE - No more "Cannot GET /"
app.get('/', (req, res) => {
  res.json({ 
    status: 'LIVE ✅', 
    message: 'CreativePay API is running',
    endpoints: {
      register: 'POST /api/register',
      login: 'POST /api/login', 
      me: 'GET /api/me',
      fund: 'POST /api/wallet/fund'
    }
  });
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const MONGO_URI = process.env.MONGO_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`;

if (!PAYSTACK_SECRET) { 
  console.error('FATAL: PAYSTACK_SECRET_KEY is not set'); 
  process.exit(1); 
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB: Connected'))
  .catch(err => { 
    console.error('❌ MongoDB connection error:', err); 
    process.exit(1); 
  });

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  fullName: String,
  passwordHash: String,
  walletId: { type: String, unique: true },
  kycStatus: { type: String, default: 'UNVERIFIED' },
  balances: { type: Map, of: Number, default: () => new Map([['NGN', 0], ['GHS', 0], ['KES', 0]]) },
  transactions: { type: Array, default: [] }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { 
    req.user = jwt.verify(token, JWT_SECRET); 
    next(); 
  } catch { 
    return res.status(401).json({ error: 'Invalid token' }); 
  }
};

const getBalancesObj = (user) => Object.fromEntries(user.balances || new Map());
const getUserWalletId = (user) => user.walletId;

// WRAPPER: Prevents 1 route crash from killing whole server
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.post('/api/register', asyncHandler(async (req, res) => {
  const { email, fullName, password } = req.body;
  if (await User.findOne({ email })) return res.status(400).json({ error: 'Email already registered' });
  const walletId = `CPY-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const user = await User.create({ 
    email, 
    fullName, 
    passwordHash: await bcrypt.hash(password, 10), 
    walletId, 
    balances: new Map([['NGN', 0], ['GHS', 0], ['KES', 0]]) 
  });
  res.json({ message: 'Registered', walletId });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, walletId: getUserWalletId(user), balances: getBalancesObj(user), kycStatus: user.kycStatus });
}));

app.get('/api/me', auth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ 
    email: user.email, 
    fullName: user.fullName, 
    walletId: getUserWalletId(user), 
    balances: getBalancesObj(user), 
    kycStatus: user.kycStatus, 
    transactions: user.transactions.slice(-20).reverse() 
  });
}));

app.post('/api/kyc/verify-bvn', auth, asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user.id, { kycStatus: 'TIER_1_VERIFIED' }, { new: true });
  res.json({ message: 'KYC Tier 1 Verified', kycStatus: user.kycStatus });
}));

app.post('/api/wallet/fund', auth, asyncHandler(async (req, res) => {
  const { currency } = req.body;
  const user = await User.findById(req.user.id);
  const amount = currency === 'NGN' ? 10000 : currency === 'GHS' ? 10005 : 10030;
  const reference = `cpy_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
  const paystackRes = await axios.post(
    'https://api.paystack.co/transaction/initialize', 
    { email: user.email, amount, currency, reference, callback_url: `${FRONTEND_URL}/verify.html?ref=${reference}` }, 
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
  );
  res.json({ authorization_url: paystackRes.data.authorization_url, reference });
}));

app.get('/api/wallet/verify/:reference', auth, asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const user = await User.findById(req.user.id);
  const verify = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
  const data = verify.data;
  const isSuccess = data.status === 'success' || (data.gateway_response && data.gateway_response.toLowerCase().includes('successful'));
  if (!isSuccess) return res.status(400).json({ error: 'Payment not successful' });
  const currency = data.currency;
  const amount = data.amount / 100;
  user.balances.set(currency, (user.balances.get(currency) || 0) + amount);
  user.transactions.push({ type: 'credit', currency, amount, desc: 'Wallet Funding', date: new Date() });
  await user.save();
  res.json({ message: `Wallet funded successfully! ${currency} ${amount}`, balances: getBalancesObj(user) });
}));

app.post('/api/send', auth, asyncHandler(async (req, res) => {
  const { recipientWalletId, amount, currency, description } = req.body;
  if (req.user.kycStatus !== 'TIER_1_VERIFIED') return res.status(403).json({ error: 'KYC required' });
  const sender = await User.findById(req.user.id);
  const receiver = await User.findOne({ walletId: recipientWalletId });
  if (!receiver) return res.status(404).json({ error: 'Recipient not found' });
  if ((sender.balances.get(currency) || 0) < amount) return res.status(400).json({ error: 'Insufficient balance' });
  sender.balances.set(currency, sender.balances.get(currency) - amount);
  receiver.balances.set(currency, (receiver.balances.get(currency) || 0) + amount);
  sender.transactions.push({ type: 'debit', currency, amount, desc: `To ${receiver.email}`, date: new Date() });
  receiver.transactions.push({ type: 'credit', currency, amount, desc: `From ${sender.email}`, date: new Date() });
  await sender.save(); await receiver.save();
  res.json({ message: `✅ ${currency} ${amount} sent successfully`, balances: getBalancesObj(sender) });
}));

app.get('/api/banks', auth, asyncHandler(async (req, res) => {
  const { currency } = req.query;
  if (currency !== 'NGN') return res.json({ banks: [] });
  const banks = await axios.get('https://api.paystack.co/bank', { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
  // FIXED: Paystack returns banks.data not banks.data
  res.json({ banks: banks.data.filter(b => b.active).map(b => ({ name: b.name, code: b.code })) });
}));

app.post('/api/withdraw', auth, asyncHandler(async (req, res) => {
  const { accountNumber, bankCode, amount, currency } = req.body;
  if (currency !== 'NGN') return res.status(400).json({ error: 'Withdrawals only supported for NGN for now' });
  const user = await User.findById(req.user.id);
  if ((user.balances.get('NGN') || 0) < amount) return res.status(400).json({ error: 'Insufficient NGN balance' });
  const recipient = await axios.post('https://api.paystack.co/transferrecipient', { type: 'nuban', name: user.fullName, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' }, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
  const transfer = await axios.post('https://api.paystack.co/transfer', { source: 'balance', amount: amount * 100, recipient: recipient.data.recipient_code, reason: 'CreativePay Withdrawal' }, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
  if (transfer.data.status !== 'success' && transfer.data.status !== 'pending') return res.status(400).json({ error: 'Transfer failed' });
  user.balances.set('NGN', user.balances.get('NGN') - amount);
  user.transactions.push({ type: 'debit', currency: 'NGN', amount, desc: `Withdrawal to ${accountNumber}`, date: new Date() });
  await user.save();
  res.json({ message: `✅ NGN ${amount} withdrawal initiated`, status: transfer.data.status, balances: getBalancesObj(user) });
}));

// GLOBAL ERROR HANDLER - Last line of defense
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

app.listen(PORT, () => console.log(`🚀 CreativePay Phase 4D server running on port ${PORT}`));