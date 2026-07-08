const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  walletId: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['credit', 'debit']
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    enum: ['NGN', 'GHS', 'KES', 'USD', 'EUR', 'GBP'],
    default: 'NGN'
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  reference: {
    type: String,
    unique: true,
    default: () => `TXN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'success', 'failed'],
    default: 'success'
  }
}, { timestamps: true });

// Index for super fast transaction history fetching per user
transactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
