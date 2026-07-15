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
    walletId: {
        type: String,
        required: true,
        unique: true
    },
    kycTier: { // FIXED: Changed from Number to String
        type: String,
        default: 'Unverified'
    },
    bvn: { // ADDED: This was missing
        type: String,
        default: null
    },
    balances: {
        NGN: { type: Number, default: 0 },
        GHS: { type: Number, default: 0 },
        KES: { type: Number, default: 0 },
        USD: { type: Number, default: 0 },
        EUR: { type: Number, default: 0 },
        GBP: { type: Number, default: 0 }
    }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);