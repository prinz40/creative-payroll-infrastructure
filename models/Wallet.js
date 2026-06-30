const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    unique: true 
  },
  walletId: { 
    type: String, 
    unique: true, 
    required: true 
  },
  // v1.6.3 FIELDS - Matches server.js exactly
  mainBalance: { type: Number, default: 0, min: 0 },
  airtimeBalance: { type: Number, default: 0, min: 0 },
  dataBalance: { type: Number, default: 0, min: 0 },
  bvn: { type: String, default: null },
  status: { 
    type: String, 
    default: 'active', 
    enum: ['active', 'frozen', 'closed'] 
  }
}, { timestamps: true });

// HELPER: For backward compatibility if old code calls getBalance('NGN')
walletSchema.methods.getBalance = function(currency = 'NGN') {
  if (currency === 'NGN') return this.mainBalance || 0;
  if (currency === 'AIRTIME') return this.airtimeBalance || 0;
  if (currency === 'DATA') return this.dataBalance || 0;
  return 0;
};

// HELPER: Add money safely
walletSchema.methods.addBalance = function(currency, amount) {
  if (currency === 'NGN') this.mainBalance += amount;
  if (currency === 'AIRTIME') this.airtimeBalance += amount;
  if (currency === 'DATA') this.dataBalance += amount;
  return this.save();
};

module.exports = mongoose.model('Wallet', walletSchema);
