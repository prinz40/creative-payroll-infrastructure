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

// COMPLIANCE LAYER: IMMUTABLE AUDIT LOG SCHEMA
const AuditLogSchema = new mongoose.Schema({
    eventType: { type: String, required: true }, // INVOICE_CREATED, PAYMENT_SETTLED, ATTACK_BLOCKED
    description: { type: String, required: true },
    ipAddress: { type: String, default: '0.0.0.0' },
    userAgent: { type: String, default: 'Unknown Device' },
    timestamp: { type: Date, default: Date.now }
});

// Compile Models
export const Invoice = mongoose.model('Invoice_v2', InvoiceSchema);
export const Transaction = mongoose.model('Transaction_v2', TransactionSchema);
export const Analytics = mongoose.model('Analytics_v2', AnalyticsSchema);
export const AuditLog = mongoose.model('AuditLog_v2', AuditLogSchema);

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
        db.analytics.totalVolumeUSD = record.totalVolumeUSD;
        db.analytics.totalFeesCollectedUSD = record.totalFeesCollectedUSD;
        db.analytics.processedPayoutsCount = record.processedPayoutsCount;
    } catch (err) {
        console.error("Failed to seed analytics:", err.message);
    }
}

// 3. ENTERPRISE TRANSACTION CONTROLLERS
export async function createInvoice(data, securityMeta = {}) {
    const invoice = await Invoice.create(data);
    
    // Log the transaction creation event immutably
    await AuditLog.create({
        eventType: 'INVOICE_CREATED',
        description: `Generated fresh invoice for ${data.creativeName} totaling $${data.amountUSD} USD.`,
        ipAddress: securityMeta.ip,
        userAgent: securityMeta.userAgent
    });
    
    return invoice;
}

export async function processBlockchainPayment(txHash, invoiceId, securityMeta = {}) {
    try {
        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) {
            return { success: false, message: "Target invoice structure not found." };
        }

        // Safe Check 2: Check settlement status to block double spending attempts
        if (invoice.status === 'SETTLED') {
            await AuditLog.create({
                eventType: 'ATTACK_BLOCKED',
                description: `CRITICAL: Double Spend Intercepted! Exploit attempt on Invoice ID: ${invoiceId}`,
                ipAddress: securityMeta.ip,
                userAgent: securityMeta.userAgent
            });
            return { success: false, message: "Transaction blocked: Invoice already settled globally." };
        }

        // Safe Check 3: Prevent duplicate transaction hash submission
        const existingTx = await Transaction.findOne({ blockchainHash: txHash });
        if (existingTx) {
            await AuditLog.create({
                eventType: 'ATTACK_BLOCKED',
                description: `CRITICAL: Replay Attack Intercepted! Duplicate blockchain hash: ${txHash}`,
                ipAddress: securityMeta.ip,
                userAgent: securityMeta.userAgent
            });
            return { success: false, message: "Transaction blocked: Ledger hash already executed." };
        }

        const gross = invoice.amountUSD;
        const platformFee = gross * 0.01;
        const net = gross - platformFee;
        
        const localRate = FX_RATES[invoice.targetCurrency] || 1;
        const localPayoutAmount = (net * localRate).toFixed(2);
        const payoutString = `${localPayoutAmount} ${invoice.targetCurrency}`;

        const transaction = await Transaction.create({
            invoiceId: invoice._id,
            blockchainHash: txHash,
            grossUSD: gross,
            platformFeeUSD: platformFee,
            netUSD: net,
            payoutLocal: payoutString
        });

        invoice.status = 'SETTLED';
        invoice.settledAt = new Date();
        invoice.txHash = txHash;
        await invoice.save();

        const updatedAnalytics = await Analytics.findOneAndUpdate(
            { company: 'CreativePay' },
            { $inc: { totalVolumeUSD: gross, totalFeesCollectedUSD: platformFee, processedPayoutsCount: 1 } },
            { new: true }
        );

        if (updatedAnalytics) {
            db.analytics.totalVolumeUSD = updatedAnalytics.totalVolumeUSD;
            db.analytics.totalFeesCollectedUSD = updatedAnalytics.totalFeesCollectedUSD;
            db.analytics.processedPayoutsCount = updatedAnalytics.processedPayoutsCount;
        }

        // Log the successful compliance event immutably
        await AuditLog.create({
            eventType: 'PAYMENT_SETTLED',
            description: `Assets Disbursed: Converted $${net.toFixed(2)} USD into ${payoutString}`,
            ipAddress: securityMeta.ip,
            userAgent: securityMeta.userAgent
        });

        return { success: true, transaction };

    } catch (err) {
        console.error("Secure Settlement Routine Failure:", err);
        return { success: false, message: "Internal ledger processing anomaly occurred." };
    }
    }
        
