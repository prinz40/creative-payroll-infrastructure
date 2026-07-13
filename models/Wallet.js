const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  walletId: {
    type: String,
    unique: true,
    required: true,
    default: () => `CPY-${uuidv4().split('-')[0].toUpperCase()}`
  },
  // Map structure with validation rules to guarantee data balance integrity
  balances: {
    type: Map,
    of: { type: Number, min: [0, 'Balance cannot be negative'] },
    default: () => ({ 'NGN': 0, 'GHS': 0, 'USD': 0 })
  },
  status: { type: String, default: 'active', enum: ['active', 'frozen', 'closed'] }
}, { timestamps: true });

// ATOMIC UPDATE: Safe addition using MongoDB atomic increments
walletSchema.statics.addBalance = async function(walletId, currency, amount) {
  return await this.findOneAndUpdate(
    { walletId, status: 'active' },
    { $inc: { [`balances.${currency}`]: amount } },
    { new: true, runValidators: true }
  );
};

// ATOMIC UPDATE: Safe subtraction preventing negative overdrafts
walletSchema.statics.deductBalance = async function(walletId, currency, amount) {
  return await this.findOneAndUpdate(
    { walletId, status: 'active', [`balances.${currency}`]: { $gte: amount } },
    { $inc: { [`balances.${currency}`]: -amount } },
    { new: true, runValidators: true }
  );
};

// Export model, with redundant compound index removed
module.exports = mongoose.model('Wallet', walletSchema);
