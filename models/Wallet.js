const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  // OLD: balance: { type: Number, default: 0, min: 0 }
  // NEW: Multi-currency balances
  balances: {
    type: Map,
    of: Number,
    default: { 'NGN': 0 } // Start everyone with NGN 0
  },
  currency: {
    type: String,
    default: 'NGN' // This is the "active" currency shown on dashboard
  },
  walletId: {
    type: String,
    unique: true,
    required: true
  },
  status: {
    type: String,
    default: 'active',
    enum: ['active', 'frozen', 'closed']
  }
}, { timestamps: true });

// HELPER: Get balance for any currency. Safe fallback to 0
walletSchema.methods.getBalance = function(currency = 'NGN') {
  return this.balances.get(currency) || 0;
};

// HELPER: Add money to a currency
walletSchema.methods.addBalance = function(currency, amount) {
  const current = this.getBalance(currency);
  this.balances.set(currency, current + amount);
  return this.save();
};

module.exports = mongoose.model('Wallet', walletSchema);