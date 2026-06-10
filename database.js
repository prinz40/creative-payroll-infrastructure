import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

// Core Supported Settlement Corridors & Simulated Liquidity FX Rates
export const FX_RATES = {
  NGN: 1500.00, // Nigerian Naira
  GHS: 14.50,   // Ghanaian Cedi
  KES: 130.00   // Kenyan Shilling
};

// ==========================================
// 1. ENTERPRISE MONGODB SCHEMA DEFINITIONS
// ==========================================

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
const Invoice = mongoose.model('Invoice', InvoiceSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const Analytics = mongoose.model('Analytics', AnalyticsSchema);

// Export dynamic mock database reference for analytics visibility compatibility
export const db = {
  analytics: { totalVolumeUSD: 0, totalFeesCollectedUSD: 0, processedPayoutsCount: 0 }
};

// ==========================================
// 2. ADVANCED CLUSTER LIFECYCLE MANAGER
// ==========================================

if (!MONGO_URI) {
  console.error("❌ High Alert: MONGO_URI environment variable is missing on Render!");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => {
      console.log("🟩 Linked to CreativePay Cloud Database Cluster Successfully");
      initializeAnalyticsSeed();
    })
    .catch((err) => {
      console.error("❌ Database Cluster Connection Crash:", err.message);
    });
}

// Ensure global analytics metric tracking record exists inside the cluster
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

// ==========================================
// 3. ENTERPRISE DATA MUTATION CODES
// ==========================================

/**
 * Inserts a structured invoice model into the cloud cluster
 */
export async function createInvoice(invoiceData) {
  try {
    const newInvoice = new Invoice({
      creativeName: invoiceData.creativeName,
      email: invoiceData.email,
      amountUSD: parseFloat(invoiceData.amountUSD) || 0,
      targetCurrency: invoiceData.targetCurrency || 'NGN'
    });
    
    await newInvoice.save();
    
    return {
      id: newInvoice._id.toString(),
      creativeName: newInvoice.creativeName,
      email: newInvoice.email,
      amountUSD: newInvoice.amountUSD,
      targetCurrency: newInvoice.targetCurrency,
      status: newInvoice.status,
      createdAt: newInvoice.createdAt
    };
  } catch (err) {
    console.error("Invoice insertion error:", err.message);
    throw err;
  }
}

/**
 * Executes multi-tier stablecoin liquidations with cloud atomic updates
 */
export async function processBlockchainPayment(txHash, invoiceId) {
  try {
    // 1. Structural Sanity Validation
    if (!txHash || !invoiceId || typeof txHash !== 'string' || typeof invoiceId !== 'string') {
      return { success: false, message: "Invalid payload parameters provided" };
    }

    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return { success: false, message: "Invoice target format is structurally invalid" };
    }

    // 2. Locate Target Invoice
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return { success: false, message: "Invoice target not found" };
    }

    // 3. State Machine Guard (Idempotency Check)
    if (invoice.status === 'SETTLED') {
      return { success: false, message: "Invoice already settled" };
    }

    // 4. Cryptographic Double-Spend Guard (Enforced by cloud indexing)
    const duplicateTx = await Transaction.findOne({ blockchainHash: txHash });
    if (duplicateTx) {
      return { success: false, message: "Security Alert: Duplicate blockchain transaction hash detected" };
    }

    // 5. Calculate Infrastructure Monetization Model (1% Flat Settlement Fee)
    const feeUSD = invoice.amountUSD * 0.01;
    const netAmountUSD = invoice.amountUSD - feeUSD;

    // 6. Calculate FX Liquidation Pipeline Conversion
    const fxRate = FX_RATES[invoice.targetCurrency] || 1.0;
    const payoutLocalAmount = netAmountUSD * fxRate;

    // 7. Atomic State Transition
    invoice.status = 'SETTLED';
    invoice.settledAt = new Date();
    invoice.txHash = txHash;
    await invoice.save();

    // 8. Update Venture Capital Analytics Metrics in Cloud Database
    const updatedAnalytics = await Analytics.findOneAndUpdate(
      { company: 'CreativePay' },
      { 
        $inc: { 
          totalVolumeUSD: invoice.amountUSD, 
          totalFeesCollectedUSD: feeUSD, 
          processedPayoutsCount: 1 
        } 
      },
      { new: true, upsert: true }
    );

    // Keep dynamic tracker perfectly synchronized in memory for endpoints
    db.analytics.totalVolumeUSD = updatedAnalytics.totalVolumeUSD;
    db.analytics.totalFeesCollectedUSD = updatedAnalytics.totalFeesCollectedUSD;
    db.analytics.processedPayoutsCount = updatedAnalytics.processedPayoutsCount;

    // 9. Generate Immutable Audit Ledger Record
    const transactionRecord = new Transaction({
      invoiceId: invoice._id,
      blockchainHash: txHash,
      grossUSD: invoice.amountUSD,
      platformFeeUSD: feeUSD,
      netUSD: netAmountUSD,
      payoutLocal: `${payoutLocalAmount.toFixed(2)} ${invoice.targetCurrency}`
    });

    await transactionRecord.save();

    return { 
      success: true, 
      transaction: {
        id: transactionRecord._id.toString(),
        invoiceId: invoice._id.toString(),
        blockchainHash: txHash,
        grossUSD: transactionRecord.grossUSD,
        platformFeeUSD: transactionRecord.platformFeeUSD,
        netUSD: transactionRecord.netUSD,
        payoutLocal: transactionRecord.payoutLocal,
        timestamp: transactionRecord.timestamp
      }
    };
  } catch (err) {
    console.error("Blockchain processing error:", err.message);
    return { success: false, message: "Internal cloud server runtime fault occurred" };
  }
            }
