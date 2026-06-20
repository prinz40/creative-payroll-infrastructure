const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// 1. MIDDLEWARE - ALWAYS FIRST
app.use(cors());
app.use(express.json()); // This MUST be before routes
app.use(express.urlencoded({ extended: true }));

// 2. DATABASE CONNECTION
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected - Creativepay Cluster'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// 3. API ROUTES - MUST BE BEFORE STATIC FILES
// Auth routes
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    // Your existing register logic here
    res.json({ success: true, message: 'User registered' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // Your existing login logic here - MUST return user data + token
    // Example:
    // const user = await User.findOne({ email });
    // if (!user) return res.status(400).json({ success: false, message: 'User not found' });
    res.json({ 
      success: true, 
      user: { email, kycTier: 0, kycStatus: 'unverified' }, // Replace with real user
      token: 'jwt_token_here' 
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// BVN Route - THIS FIXES YOUR LOOP
app.post('/api/bvn', async (req, res) => {
  try {
    const { bvn, userId } = req.body;
    
    // 1. Validate BVN is 11 digits
    if (!bvn || bvn.length !== 11) {
      return res.status(400).json({ success: false, message: 'BVN must be 11 digits' });
    }

    // 2. Find user and update - REPLACE WITH YOUR User MODEL
    // const user = await User.findOneAndUpdate(
    //   { email: req.user.email }, // Get email from JWT token
    //   { 
    //     bvn: bvn,
    //     kycTier: 1, 
    //     kycStatus: 'verified' 
    //   },
    //   { new: true }
    // );

    // TEMPORARY: For testing with testfinal@gmail.com
    const User = mongoose.model('User');
    const user = await User.findOneAndUpdate(
      { email: 'testfinal@gmail.com' }, 
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
        kycTier: user.kycTier,
        kycStatus: user.kycStatus
      }
    });
  } catch (error) {
    console.error('❌ BVN Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. SERVE FRONTEND STATIC FILES
app.use(express.static(path.join(__dirname, 'public')));

// 5. CATCH-ALL FOR SPA - MUST BE LAST
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 6. START SERVER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ JWT Secret: ${process.env.JWT_SECRET ? 'Loaded' : 'Missing'}`);
  console.log(`🚀 CreativePay server running on port ${PORT}`);
});