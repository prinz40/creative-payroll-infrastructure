const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const SUPPORTED_CURRENCIES = ['NGN', 'GHS', 'KES', 'USD', 'EUR', 'GBP'];

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  walletId: {
    type: String,
    unique: true,
    required: true,
    default: () => `CP${uuidv4().split('-')[0].toUpperCase()}` // MATCHES server.js: 'CP' + crypto
  },
  // Map structure with validation rules to guarantee data balance integrity
  balances: {
    type: Map,
    of: { type: Number, min: [0, 'Balance cannot be negative'] },
    default: () => {
      const init = {};
      SUPPORTED_CURRENCIES.forEach(c => init[c] = 0);
      return init;
    }
  },
  status: { type: String, default: 'active', enum: ['active', 'frozen', 'closed'] }
}, { timestamps: true });

// HELPER: Ensure currency exists in map before increment
function ensureCurrency(balanceMap, currency) {
  if (!balanceMap.has(currency)) {
    balanceMap.set(currency, 0);
  }
}

// ATOMIC UPDATE: Safe addition using MongoDB atomic increments
walletSchema.statics.addBalance = async function(walletId, currency, amount) {
  const ccy = currency.toUpperCase();
  return await this.findOneAndUpdate(
    { walletId, status: 'active' },
    { $inc: { [`balances.${ccy}`]: amount } },
    { new: true, upsert: false, runValidators: true }
  );
};

// ATOMIC UPDATE: Safe subtraction preventing negative overdrafts
walletSchema.statics.deductBalance = async function(walletId, currency, amount) {
  const ccy = currency.toUpperCase();
  const result = await this.findOneAndUpdate(
    { walletId, status: 'active', [`balances.${ccy}`]: { $gte: amount } },
    { $inc: { [`balances.${ccy}`]: -amount } },
    { new: true, runValidators: true }
  );
  if (!result) throw new Error(`Insufficient balance or wallet not found for ${ccy}`);
  return result;
};

// UTILITY: Get wallet with populated user
walletSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId }).populate('userId', 'name email');
};

module.exports = mongoose.model('Wallet', walletSchema);