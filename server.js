import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === DATABASE CONNECTION ===
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Linked to CreativePay Cloud Database Cluster Successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// === MONGOOSE MODELS ===
const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  mobileNumber: { type: String },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

const InvoiceSchema = new mongoose.Schema({
  creativeName: String,
  email: String,
  amountUSD: Number,
  targetCurrency: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Invoice = mongoose.model('Invoice', InvoiceSchema);

// === AUTH MIDDLEWARE ===
const authGuard = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// === TIER 1: HEALTH CHECK ===
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OPERATIONAL' });
});

// === AUTH ROUTES ===
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, password, mobileNumber } = req.body;
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ fullName, email, password: hashedPassword, mobileNumber });
    await user.save();
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: user._id, fullName: user.fullName, email: user.email }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user._id, fullName: user.fullName, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// === TIER 2: INVOICES PIPELINE - PROTECTED ===
app.post('/api/invoices', authGuard, async (req, res) => {
  try {
    const { creativeName, email, amountUSD, targetCurrency } = req.body;
    if (!creativeName || !email || !amountUSD) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const invoice = new Invoice({
      creativeName,
      email,
      amountUSD,
      targetCurrency,
      userId: req.user.userId
    });
    await invoice.save();
    res.status(201).json({ message: 'Invoice created successfully', invoice });
  } catch (err) {
    console.error('Invoice creation error:', err);
    res.status(500).json({ error: 'Internal server error occurred' });
  }
});

app.get('/api/invoices', authGuard, async (req, res) => {
  try {
    const userInvoices = await Invoice.find({ userId: req.user.userId });
    res.json(userInvoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === SERVE FRONTEND - MUST BE LAST ===
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === START SERVER ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});