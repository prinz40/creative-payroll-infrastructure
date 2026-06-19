// server.js - CreativePay Backend v2.0 - BULLETPROOF
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();

// ===== MIDDLEWARE =====
app.use(cors({
  origin: '*', // Change to your frontend URL in production
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== MONGODB CONNECTION =====
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://your-connection-string', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected - Creativepay Cluster'))
.catch(err => console.error('❌ MongoDB Error:', err));

// ===== USER SCHEMA =====
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  phone: { type: String },
  provider: { type: String, default: 'email' },
  country: { type: String, default: 'Nigeria' },
  balance: { type: Number, default: 0 },
  
  // KYC FIELDS - THIS WAS YOUR BUG
  bvn: { type: String, default: null },
  kycTier: { type: Number, default: 0 }, // 0=unverified, 1=tier1, 2=tier2
  kycStatus: { type: String, default: 'unverified', enum: ['unverified', 'pending', 'verified', 'rejected'] },
  
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// ===== JWT HELPER FUNCTIONS =====
const generateAccessToken = (userId, email) => {
  return jwt.sign(
    { userId, email },
    process.env.JWT_SECRET || 'your-secret-key-change-this',
    { expiresIn: '7d' } // 7 days for mobile stability
  );
};

// Auth Middleware - Use this on protected routes
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-this');
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(403).json({ success: false, message: 'User not found' });
    }

    req.user = user; // Attach full user object
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
};

// ===== AUTH ROUTES =====

// 1. REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name ||!email ||!password) {
      return res.status(400).json({ success: false, message: 'Name, email, password required' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phone,
      kycTier: 0,
      kycStatus: 'unverified'
    });

    const token = generateAccessToken(user._id, user.email);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        kycTier: user.kycTier,
        kycStatus: user.kycStatus,
        balance: user.balance
      }
    });
  } catch (error) {
    console.error('Register Error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

// 2. LOGIN - STABLE WITH KYC CHECK
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email ||!password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    const token = generateAccessToken(user._id, user.email);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        kycTier: user.kycTier, // CRITICAL: Frontend uses this to check verification
        kycStatus: user.kycStatus,
        balance: user.balance
      }
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// 3. LOGOUT - Client-side mostly, but endpoint for completeness
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    // In JWT, logout is client-side by deleting token
    // This endpoint just confirms logout
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 4. GET CURRENT USER - For re-login/auto-login stability
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    // req.user is already attached by middleware
    res.json({
      success: true,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        kycTier: req.user.kycTier, // Frontend checks this on app start
        kycStatus: req.user.kycStatus,
        balance: req.user.balance
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ===== KYC ROUTES =====

// 5. BVN VERIFICATION - THIS WAS THE BUG - NOW FIXED
app.post('/api/kyc/verify-bvn', authenticateToken, async (req, res) => {
  try {
    const { bvn } = req.body;

    if (!bvn || bvn.length!== 11) {
      return res.status(400).json({ success: false, message: 'Valid 11-digit BVN required' });
    }

    // Check if BVN already used by another user
    const bvnExists = await User.findOne({ bvn, _id: { $ne: req.user._id } });
    if (bvnExists) {
      return res.status(400).json({ success: false, message: 'BVN already registered to another account' });
    }

    // ===== DOJAH API CALL =====
    // Replace with your actual Dojah integration
    const dojahResponse = await axios.get(`https://api.dojah.io/api/v1/kyc/bvn/full?bvn=${bvn}`, {
      headers: {
        'AppId': process.env.DOJAH_APP_ID,
        'Authorization': process.env.DOJAH_PRIVATE_KEY
      }
    });

    if (dojahResponse.data.entity) {
      // ===== CRITICAL FIX: ACTUALLY UPDATE THE DATABASE =====
      const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        {
          $set: {
            bvn: bvn,
            kycTier: 1, // UPGRADE TO TIER 1
            kycStatus: 'verified'
          }
        },
        { new: true } // Return updated document
      );

      console.log(`✅ BVN Verified for ${updatedUser.email} - kycTier: ${updatedUser.kycTier}`);

      return res.json({
        success: true,
        message: 'BVN verified successfully',
        user: {
          id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          kycTier: updatedUser.kycTier, // Now returns 1
          kycStatus: updatedUser.kycStatus
        },
        dojahData: dojahResponse.data.entity // Optional: send data to frontend
      });
    } else {
      return res.status(400).json({ success: false, message: 'BVN verification failed' });
    }

  } catch (error) {
    console.error('BVN Verification Error:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      message: error.response?.data?.message || 'BVN verification failed' 
    });
  }
});

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'CreativePay API v2.0 Running',
    timestamp: new Date().toISOString()
  });
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET? 'Loaded' : 'USING DEFAULT - CHANGE THIS!'}`);
});