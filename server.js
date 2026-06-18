const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/creativepay';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// ======================
// USER SCHEMA - UPGRADED FOR KYC
// ======================
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  provider: { type: String },
  country: { type: String, default: 'Nigeria' },
  balance: { type: Number, default: 0 },
  
  // KYC Fields - Tier System
  kycStatus: { 
    type: String, 
    enum: ['unverified', 'pending', 'verified', 'rejected'],
    default: 'unverified' 
  },
  kycTier: { type: Number, default: 0 }, // 0=none, 1=BVN, 2=ID, 3=Business
  bvn: { type: String, select: false }, // Hidden from API responses
  
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'creativepay-secret-key-2026';

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token.' });
  }
};

// ======================
// ROUTES
// ======================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'CreativePay API is running',
    timestamp: new Date().toISOString()
  });
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone, provider, country } = req.body;
    
    // Validation
    if (!name ||!email ||!password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user - kycStatus defaults to 'unverified'
    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone,
      provider,
      country
    });
    
    await user.save();
    
    res.status(201).json({
      message: 'Account created successfully',
      userId: user._id
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email ||!password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT - Now includes name for dashboard
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        kycStatus: user.kycStatus, // Send KYC status to frontend
        kycTier: user.kycTier
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ======================
// NEW: KYC VERIFICATION - TIER 1
// ======================
app.post('/api/kyc/verify-bvn', authenticateToken, async (req, res) => {
  try {
    const { bvn } = req.body;
    
    // Basic validation
    if (!bvn || bvn.length!== 11 ||!/^\d+$/.test(bvn)) {
      return res.status(400).json({ error: 'BVN must be 11 digits' });
    }
    
    // TODO PRODUCTION: Integrate Paystack/Flutterwave BVN Verification API here
    // For MVP: Accept any 11 digits as valid
    
    const user = await User.findByIdAndUpdate(
      req.user.id, 
      { 
        bvn: bvn,
        kycStatus: 'verified',
        kycTier: 1 
      },
      { new: true }
    ).select('-password -bvn'); // Don't send bvn back
    
    res.json({ 
      message: 'BVN verified successfully. Tier 1 activated.',
      kycStatus: user.kycStatus,
      kycTier: user.kycTier
    });
    
  } catch (error) {
    console.error('BVN verification error:', error);
    res.status(500).json({ error: 'Server error during BVN verification' });
  }
});

// Get User Profile - Protected Route WITH KYC GATE
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -bvn');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // KYC GATE: This is the professional VC-level check
    if (user.kycStatus === 'unverified') {
      return res.status(403).json({ 
        error: 'KYC required',
        kycStatus: 'unverified',
        message: 'Please complete BVN verification to access your dashboard',
        nextStep: '/verify-bvn'
      });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});