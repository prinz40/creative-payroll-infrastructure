import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

// Core Supported Settlement Corridors & Simulated Liquidity FX Rates
export const FX_RATES = {
    NGN: 1500.00, // Nigerian Naira
    GHS: 14.50,  // Ghanaian Cedi
    KES: 130.00  // Kenyan Shilling
};

// 1. ENTERPRISE MONGODB SCHEMA DEFINITIONS
const InvoiceSchema = new mongoose.Schema({
    creativeName: { type: String, required: true },
    email: { type: String, required: true },
    amountUSD: { type: Number, required: true },
    targetCurrency: { type: String, default: 'NGN' },
    status: { type: String, default: 'PENDING', enum: ['PENDING', 'SETTLED'] },
    createdAt: { type: Date, default: Date.now },
    settledAt: { type: Date },
    txHash: { type: String }
});

const TransactionSchema = new mongoose.Schema({
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    blockchainHash: { type: String, required: true, unique: true },
    grossUSD: { type: Number, required: true },
    platformFeeUSD: { type: Number, required: true },
    netUSD: { type: Number, required: true },
    payoutLocal: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const AnalyticsSchema = new mongoose.Schema({
    company: { type: String, default: 'CreativePay', unique: true },
    totalVolumeUSD: { type: Number, default: 0 },
    totalFeesCollectedUSD: { type: Number, default: 0 },
    processedPayoutsCount: { type: Number, default: 0 }
});

// Compile Models
export const Invoice = mongoose.model('Invoice_v2', InvoiceSchema);
export const Transaction = mongoose.model('Transaction_v2', TransactionSchema);
export const Analytics = mongoose.model('Analytics_v2', AnalyticsSchema);

// Export dynamic mock database reference for analytics visibility compatibility
export const db = {
    analytics: { totalVolumeUSD: 0, totalFeesCollectedUSD: 0, processedPayoutsCount: 0 }
};

// 2. ADVANCED CLUSTER LIFECYCLE MANAGER
if (!MONGO_URI) {
    console.error("❌ High Alert: MONGO_URI environment variable is missing on Render!");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => {
            console.log("🔗 Linked to CreativePay Cloud Database Cluster Successfully (v2 Engine)");
            initializeAnalyticsSeed();
        })
        .catch((err) => {
            console.error("❌ Database Cluster Connection Crash:", err.message);
        });
}

async function initializeAnalyticsSeed() {
    try {
        let record = await Analytics.findOne({ company: 'CreativePay' });
        if (!record) {
            record = await Analytics.create({ company: 'CreativePay' });
        }
        // Keep local dynamic variable tracking perfectly synchronized in real-time
        db.analytics.totalVolumeUSD = record.totalVolumeUSD;
        db.analytics.totalFeesCollectedUSD = record.totalFeesCollectedUSD;
        db.analytics.processedPayoutsCount = record.processedPayoutsCount;
    } catch (err) {
        console.error("Failed to seed analytics:", err.message);
    }
}

// 3. ENTERPRISE TRANSACTION CONTROLLERS
export async function createInvoice(data) {
    return await Invoice.create(data);
}

export async function processBlockchainPayment(txHash, invoiceId) {
    try {
        // Safe Check 1: Verify the invoice structure actually exists
        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) {
            return { success: false, message: "Target invoice structure not found." };
        }

        // Safe Check 2: Check settlement status to block double spending attempts
        if (invoice.status === 'SETTLED') {
            return { success: false, message: "Transaction blocked: Invoice already settled globally." };
        }

        // Safe Check 3: Prevent duplicate transaction hash submission
        const existingTx = await Transaction.findOne({ blockchainHash: txHash });
        if (existingTx) {
            return { success: false, message: "Transaction blocked: Ledger hash already executed." };
        }

        // Financial Calculation Logic
        const gross = invoice.amountUSD;
        const platformFee = gross * 0.01; // 1% operational fee
        const net = gross - platformFee;
        
        const localRate = FX_RATES[invoice.targetCurrency] || 1;
        const localPayoutAmount = (net * localRate).toFixed(2);
        const payoutString = `${localPayoutAmount} ${invoice.targetCurrency}`;

        // Create the official immutable transaction ledger record
        const transaction = await Transaction.create({
            invoiceId: invoice._id,
            blockchainHash: txHash,
            grossUSD: gross,
            platformFeeUSD: platformFee,
            netUSD: net,
            payoutLocal: payoutString
        });

        // Update the foundational invoice status securely
        invoice.status = 'SETTLED';
        invoice.settledAt = new Date();
        invoice.txHash = txHash;
        await invoice.save();

        // Atomically update global platform analytics counters
        const updatedAnalytics = await Analytics.findOneAndUpdate(
            { company: 'CreativePay' },
            { 
                $inc: { 
                    totalVolumeUSD: gross, 
                    totalFeesCollectedUSD: platformFee, 
                    processedPayoutsCount: 1 
                } 
            },
            { new: true }
        );

        if (updatedAnalytics) {
            db.analytics.totalVolumeUSD = updatedAnalytics.totalVolumeUSD;
            db.analytics.totalFeesCollectedUSD = updatedAnalytics.totalFeesCollectedUSD;
            db.analytics.processedPayoutsCount = updatedAnalytics.processedPayoutsCount;
        }

        return { success: true, transaction };

    } catch (err) {
        console.error("Secure Settlement Routine Failure:", err);
        return { success: false, message: "Internal ledger processing anomaly occurred." };
    }
                            }
  
