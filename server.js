const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// 1. MIDDLEWARE - ORDER MATTERS
app.use(cors());
app.use(express.json());

// 2. SERVE FRONTEND FILES FROM 'public' FOLDER 👈 THIS FIXES YOUR PROBLEM
app.use(express.static(path.join(__dirname, 'public')));

// 3. MONGODB CONNECTION
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected - Creativepay Cluster'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// 4. API HEALTH CHECK - This is what you saw as JSON
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'CreativePay API v2.0 Running',
    timestamp: new Date().toISOString()
  });
});

// 5. YOUR EXISTING API ROUTES GO HERE
// Example: app.use('/api/auth', require('./routes/auth'));
// Example: app.use('/api/bvn', require('./routes/bvn'));
// Paste all your route files here...

// 6. CATCH-ALL: Send index.html for any other route
// This lets your frontend handle routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 7. START SERVER
app.listen(PORT, () => {
  console.log(`✅ JWT Secret: ${process.env.JWT_SECRET ? 'Loaded' : 'Missing'}`);
  console.log(`🚀 CreativePay server running on port ${PORT}`);
});