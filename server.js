const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// =========================
// 1. MIDDLEWARE - ALWAYS FIRST
// =========================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// 2. DATABASE CONNECTION
// =========================
mongoose.connect(process.env.MONGODB_URI)
 .then(() => console.log('✅ MongoDB Connected - Creativepay Cluster'))
 .catch(err => console.error('❌ MongoDB Error:', err));

// =========================
// 3. DATABASE MODELS
// =========================
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  fullName: {
    type: String,
    trim: true
  },
  bvn: {
    type: String,
    default: null
  },
  kycTier: {
    type: Number,
    default: 0
  },
  kycStatus: {
    type: String,
    default: 'unverified',
    enum: ['unverified', 'pending', 'verified', 'rejected']
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// =========================
// 4. AUTH MIDDLEWARE - FOR PROTECTED ROUTES
// =========================
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// =========================
// 5. API ROUTES - MUST BE BEFORE STATIC FILES
// =========================

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    // Validation
    if (!email ||!password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create and save user
    const user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      fullName,
      kycTier: 0,
      kycStatus: 'unverified'
    });

    await user.save();

    // Create JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('✅ User registered:', user.email);
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        email: user.email,
        fullName: user.fullName,
        kycTier: user.kycTier,
        kycStatus: user.kycStatus
      },
      token: token
    });
  } catch (error) {
    console.error('❌ Register Error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email ||!password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Create token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('✅ User logged in:', user.email);
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        email: user.email,
        fullName: user.fullName,
        kycTier: user.kycTier,
        kycStatus: user.kycStatus
      },
      token: token
    });
  } catch (error) {
    console.error('❌ Login Error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// BVN VERIFICATION - PROTECTED ROUTE
app.post('/api/bvn', authMiddleware, async (req, res) => {
  try {
    const { bvn } = req.body;
    const userEmail = req.user.email;

    // Validate BVN is 11 digits
    if (!bvn || bvn.length!== 11 ||!/^\d+$/.test(bvn)) {
      return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    }

    // Find user and update
    const user = await User.findOneAndUpdate(
      { email: userEmail },
      {
        bvn: bvn,
        kycTier: 1,
        kycStatus: 'verified'
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    console.log('✅ BVN Verified for:', user.email);
    res.json({
      success: true,
      message: 'BVN verified successfully',
      user: {
        email: user.email,
        fullName: user.fullName,
        kycTier: user.kycTier,
        kycStatus: user.kycStatus
      }
    });
  } catch (error) {
    console.error('❌ BVN Error:', error);
    res.status(500).json({ success: false, error: 'BVN verification failed' });
  }
});

// GET CURRENT USER - PROTECTED ROUTE
app.get('/api/user', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

// =========================
// 6. SERVE FRONTEND STATIC FILES
// =========================
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// 7. CATCH-ALL FOR SPA - MUST BE LAST
// =========================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =========================
// 8. START SERVER
// =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ JWT Secret: ${process.env.JWT_SECRET? 'Loaded' : 'MISSING - ADD TO.env'}`);
  console.log(`✅ MongoDB: ${process.env.MONGODB_URI? 'Connected' : 'MISSING - ADD TO.env'}`);
  console.log(`🚀 CreativePay server running on port ${PORT}`);
});