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
  // We keep the Map structure, but enforce values to preserve scaling rules
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


// HELPER: Safely retrieve any balance with standard decimal fallbacks
walletSchema.methods.getBalance = function(currency = 'NGN') {
  const amount = this.balances.get(currency);
  return amount !== undefined ? parseFloat(amount.toFixed(2)) : 0;
};

// ATOMIC UPDATE: Safe addition using MongoDB atomic increments to avoid race conditions
walletSchema.statics.addBalance = async function(walletId, currency, amount) {
  if (amount <= 0) throw new Error('Amount must be greater than 0');
  
  // Format to standard 2-decimal maximum limit securely
  const cleanAmount = parseFloat(amount.toFixed(2));

  const updatedWallet = await this.findOneAndUpdate(
    { walletId: walletId, status: 'active' },
    { $inc: { [`balances.${currency}`]: cleanAmount } },
    { new: true, runValidators: true }
  );

  if (!updatedWallet) throw new Error('Wallet not found or is currently frozen/closed');
  return updatedWallet;
};

// ATOMIC UPDATE: Safe subtraction checking balances atomically to prevent negative overdrafts
walletSchema.statics.deductBalance = async function(walletId, currency, amount) {
  if (amount <= 0) throw new Error('Amount must be greater than 0');
  
  const cleanAmount = parseFloat(amount.toFixed(2));

  // The critical check: balances must be greater than or equal to the deduction cleanAmount
  const updatedWallet = await this.findOneAndUpdate(
    { 
      walletId: walletId, 
      status: 'active',
      [`balances.${currency}`]: { $gte: cleanAmount } 
    },
    { $inc: { [`balances.${currency}`]: -cleanAmount } },
    { new: true, runValidators: true }
  );

  if (!updatedWallet) {
    throw new Error(`Transaction failed: Insufficient ${currency} balance or wallet unavailable`);
  }
  return updatedWallet;
};

// HELPER: Convert Map explicitly to clean JSON object for API consumption
walletSchema.methods.getAllBalances = function() {
  const balanceObj = Object.fromEntries(this.balances);
  for (const [key, value] of Object.entries(balanceObj)) {
    balanceObj[key] = parseFloat(value.toFixed(2));
  }
  return balanceObj;
};

// Compound indexing configurations for rapid transactional lookups
walletSchema.index({ userId: 1 });
walletSchema.index({ walletId: 1 }, { unique: true });

module.exports = mongoose.model('Wallet', walletSchema);