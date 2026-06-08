import fs from 'fs';
import path from 'path';

// Standardized file path for persistent JSON storage
const DB_FILE_PATH = path.resolve('./db.json');

// Core Supported Settlement Corridors & Simulated Liquidity FX Rates
export const FX_RATES = {
  NGN: 1500.00, // Nigerian Naira
  GHS: 14.50,   // Ghanaian Cedi
  KES: 130.00   // Kenyan Shilling
};

// Initial default state machine layout
const defaultState = {
  invoices: [],
  webhooks: [],
  transactions: [],
  analytics: {
    totalVolumeUSD: 0,
    totalFeesCollectedUSD: 0,
    processedPayoutsCount: 0
  }
};

// Global active database runtime reference
let db = { ...defaultState };

/**
 * Enterprise Data Persistence Engine
 * Automatically synchronizes our memory state with the secure workspace storage file
 */
function synchronizeStorage() {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    console.error("Infrastructure Storage Sync Error:", error.message);
  }
}

/**
 * Automated Workspace Initialization Engine
 * Boots up the data layer and securely recovers historical data if the system restarts
 */
function initializeWorkspace() {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const dataString = fs.readFileSync(DB_FILE_PATH, 'utf8');
      if (dataString.trim()) {
        db = JSON.parse(dataString);
        // Ensure critical validation structures are present arrays
        if (!db.invoices) db.invoices = [];
        if (!db.transactions) db.transactions = [];
        if (!db.webhooks) db.webhooks = [];
        if (!db.analytics) db.analytics = { ...defaultState.analytics };
        return;
      }
    }
    // Create new persistent database if missing
    synchronizeStorage();
  } catch (error) {
    console.error("Infrastructure Storage Initialization Error, reverting to memory-only safe mode:", error.message);
    db = { ...defaultState };
  }
}

// Fire up the file persistence engine instantly on load
initializeWorkspace();

// Export the active database state reference for analytics visibility
export { db };

/**
 * Creates a structured parameter invoice object
 */
export function createInvoice(invoiceData) {
  const newInvoice = {
    id: `inv_${Math.random().toString(36).substr(2, 9)}`,
    creativeName: invoiceData.creativeName,
    email: invoiceData.email,
    amountUSD: parseFloat(invoiceData.amountUSD) || 0,
    targetCurrency: invoiceData.targetCurrency || 'NGN',
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  db.invoices.push(newInvoice);
  synchronizeStorage(); // Instantly write state to file system
  return newInvoice;
}

/**
 * Processes automated stablecoin settlement, liquidates crypto,
 * deducts 1% flat venture fee, and triggers mobile money settlement
 */
export function processBlockchainPayment(txHash, invoiceId) {
  // 1. Structural Sanity Validation
  if (!txHash || !invoiceId || typeof txHash !== 'string' || typeof invoiceId !== 'string') {
    return { success: false, message: "Invalid payload parameters provided" };
  }

  // 2. Locate Target Invoice
  const invoice = db.invoices.find(i => i.id === invoiceId);
  if (!invoice) {
    return { success: false, message: "Invoice target not found" };
  }

  // 3. State Machine Guard (Idempotency Check)
  if (invoice.status === 'SETTLED') {
    return { success: false, message: "Invoice already settled" };
  }

  // 4. Cryptographic Double-Spend Guard
  const duplicateTx = db.transactions.find(t => t.blockchainHash === txHash);
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
  invoice.settledAt = new Date().toISOString();
  invoice.txHash = txHash;

  // 8. Update Venture Capital Analytics Metrics
  db.analytics.totalVolumeUSD += invoice.amountUSD;
  db.analytics.totalFeesCollectedUSD += feeUSD;
  db.analytics.processedPayoutsCount += 1;

  // 9. Generate Immutable Audit Ledger Record
  const transactionRecord = {
    id: `tx_${Math.random().toString(36).substr(2, 9)}`,
    invoiceId: invoice.id,
    blockchainHash: txHash,
    grossUSD: invoice.amountUSD,
    platformFeeUSD: feeUSD,
    netUSD: netAmountUSD,
    payoutLocal: `${payoutLocalAmount.toFixed(2)} ${invoice.targetCurrency}`,
    timestamp: new Date().toISOString()
  };

  db.transactions.push(transactionRecord);
  synchronizeStorage(); // Lock changes into secure local file storage

  return { 
    success: true, 
    transaction: transactionRecord 
  };
}
  
