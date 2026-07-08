const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

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
    required: true,
    default: () => `CPY-${uuidv4().split('-')[0].toUpperCase()}`
  },
  balances: {
    type: Map,
    of: Number,
    default: () => ({
      'NGN': 0, 
      'GHS': 0, 
      'KES': 0,
      'USD': 0,
      'EUR': 0,
      'GBP': 0
    })
  },
  defaultCurrency: {
    type: String,
    default: 'NGN',
    enum: ['NGN', 'GHS', 'KES', 'USD', 'EUR', 'GBP']
  },
  status: { 
    type: String, 
    default: 'active', 
    enum: ['active', 'frozen', 'closed'] 
  },
  kycStatus: {
    type: String,
    default: 'KYC TIER 1 VERIFIED',
    enum: ['UNVERIFIED', 'KYC TIER 1 VERIFIED', 'KYC TIER 2 VERIFIED']
  }
}, { timestamps: true });


// HELPER: Get balance for any currency. Safe fallback to 0
walletSchema.methods.getBalance = function(currency = 'NGN') {
  return this.balances.get(currency) || 0;
};

// HELPER: Add money to a currency - with validation
walletSchema.methods.addBalance = async function(currency, amount) {
  if(amount <= 0) throw new Error('Amount must be greater than 0');
  const current = this.getBalance(currency);
  this.balances.set(currency, parseFloat((current + amount).toFixed(2)));
  return await this.save();
};

// HELPER: Deduct money from a currency - with validation
walletSchema.methods.deductBalance = async function(currency, amount) {
  const current = this.getBalance(currency);
  if(current < amount) throw new Error(`Insufficient ${currency} balance`);
  this.balances.set(currency, parseFloat((current - amount).toFixed(2)));
  return await this.save();
};

// HELPER: Get all balances as object for frontend
walletSchema.methods.getAllBalances = function() {
  return Object.fromEntries(this.balances);
};

// ✅ ONLY KEEP THIS INDEX
walletSchema.index({ userId: 1 });

module.exports = mongoose.model('Wallet', walletSchema);