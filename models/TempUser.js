const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['admin', 'employee', 'employer'],
        default: 'employer'
    },
    walletId: { // added this so we can link to wallet
        type: String,
        required: true,
        unique: true
    },
    kycTier: { // added this for BVN verification
        type: Number,
        default: 0
    },
    balances: { // added this so login returns balances
        NGN: { type: Number, default: 0 },
        GHS: { type: Number, default: 0 },
        KES: { type: Number, default: 0 },
        USD: { type: Number, default: 0 },
        EUR: { type: Number, default: 0 },
        GBP: { type: Number, default: 0 }
    }
}, { timestamps: true }); // changed from createdAt to timestamps

module.exports = mongoose.model('User', UserSchema);
