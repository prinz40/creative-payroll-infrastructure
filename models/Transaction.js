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
    enum: ['credit', 'debit', 'transfer', 'funding', 'withdrawal'] // added more types for payroll
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
  description: { // added this so we know what the transaction was for
    type: String,
    default: ''
  },
  reference: { // added this for Paystack reference
    type: String,
    unique: true,
    sparse: true
  },
  status: { // added this
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  }
}, { timestamps: true }); // this adds createdAt and updatedAt automatically

module.exports = mongoose.model('Transaction', transactionSchema);