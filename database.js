// CreativePay In-Memory Database Layer
// Handles Users, Invoices, Audit Logs, Analytics

// === CORE DB STORE ===
export const db = {
  users: [],
  invoices: [],
  audit: [],
  analytics: {
    totalInvoices: 0,
    settledInvoices: 0,
    totalVolumeUSD: 0,
    totalFeesUSD: 0
  }
};

// === USER HELPERS ===
export function findUserByEmail(email) {
  return db.users.find(user => user.email === email.toLowerCase()) || null;
}

export function findUserById(userId) {
  return db.users.find(user => user.id === userId) || null;
}

export function addUser(userData) {
  const user = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    email: userData.email.toLowerCase(),
    password: userData.password, // Already hashed from server.js
    creativeName: userData.creativeName,
    mobileMoneyNumber: userData.mobileMoneyNumber || '',
    mobileMoneyProvider: userData.mobileMoneyProvider || 'None',
    country: userData.country || 'NGN',
    role: userData.role || 'creator',
    createdAt: new Date()
  };
  db.users.push(user);
  return user;
}

// === INVOICE LOGIC ===
export async function createInvoice({ creativeName, email, amountUSD, targetCurrency, userId }) {
  const invoice = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    userId: userId,
    creativeName: creativeName,
    email: email,
    amountUSD: parseFloat(amountUSD),
    targetCurrency: targetCurrency || 'NGN',
    status: 'Created',
    txHash: null,
    createdAt: new Date(),
    settledAt: null,
    feeUSD: parseFloat(amountUSD) * 0.01, // 1% flat fee
    netUSD: parseFloat(amountUSD) * 0.99
  };

  db.invoices.push(invoice);
  db.analytics.totalInvoices += 1;
  
  return invoice;
}

export function findInvoiceById(invoiceId) {
  return db.invoices.find(inv => inv.id === invoiceId) || null;
}

export function getUserInvoices(userId) {
  return db.invoices.filter(inv => inv.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
}

// === BLOCKCHAIN SETTLEMENT ===
export async function processBlockchainPayment(txHash, invoiceId) {
  const invoice = findInvoiceById(invoiceId);
  
  if (!invoice) {
    return { success: false, message: 'Invoice not found' };
  }
  
  if (invoice.status === 'Settled') {
    return { success: false, message: 'Invoice already settled. Anti-Double Spend Guard activated' };
  }

  // Simulate blockchain verification delay
  await new Promise(resolve => setTimeout(resolve, 500));

  // Update invoice
  invoice.status = 'Settled';
  invoice.txHash = txHash;
  invoice.settledAt = new Date();

  // Update analytics
  db.analytics.settledInvoices += 1;
  db.analytics.totalVolumeUSD += invoice.amountUSD;
  db.analytics.totalFeesUSD += invoice.feeUSD;

  // Mock mobile money payout calculation
  const fxRates = { NGN: 1584, GHS: 12.5, KES: 129 };
  const rate = fxRates[invoice.targetCurrency] || 1584;
  const payoutAmount = invoice.netUSD * rate;

  const transaction = {
    invoiceId: invoice.id,
    txHash: txHash,
    grossUSD: invoice.amountUSD,
    feeUSD: invoice.feeUSD,
    netUSD: invoice.netUSD,
    payoutAmount: payoutAmount,
    payoutCurrency: invoice.targetCurrency,
    mobileMoneyRef: 'MM' + Math.random().toString(36).substr(2, 9).toUpperCase(),
    timestamp: new Date()
  };

  return { success: true, transaction };
}

// === AUDIT LOG ===
export function addAuditLog({ eventType, description, ipAddress, userAgent, invoiceId, userId }) {
  const log = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    eventType,
    description,
    ipAddress: ipAddress || 'Unknown',
    userAgent: userAgent || 'Unknown',
    invoiceId: invoiceId || null,
    userId: userId || null,
    timestamp: new Date()
  };
  
  db.audit.push(log);
  return log;
}

export function getUserAuditLogs(userId, limit = 50) {
  return db.audit
   .filter(log => log.userId === userId)
   .sort((a, b) => b.timestamp - a.timestamp)
   .slice(0, limit);
}

// === ANALYTICS ===
export function getAnalytics() {
  const conversionRate = db.analytics.totalInvoices > 0 
    ? (db.analytics.settledInvoices / db.analytics.totalInvoices * 100).toFixed(2)
    : 0;
    
  return {
    ...db.analytics,
    conversionRate: parseFloat(conversionRate)
  };
}

// === INIT ===
console.log('CreativePay Database Layer Initialized');
console.log(`Users: ${db.users.length} | Invoices: ${db.invoices.length}`);