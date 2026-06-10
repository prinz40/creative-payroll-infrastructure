import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, createInvoice, processBlockchainPayment } from './database.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Resolve ES module file paths safely for the production server environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// Premium Interface Route: Securely delivers our control dashboard to investors
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Tier 1: Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: "OPERATIONAL" });
});

// Tier 2: Invoices Pipeline Endpoint
app.post('/api/invoices', (req, res) => {
  const { creativeName, email, amountUSD, targetCurrency } = req.body;
  
  if (!creativeName || !email || !amountUSD) {
    return res.status(400).json({ error: "Missing required parameters: creativeName, email, and amountUSD are mandatory" });
  }

  const invoice = createInvoice({ creativeName, email, amountUSD, targetCurrency });
  res.status(201).json({ message: "Invoice created successfully", invoice });
});

// Tier 3 & 4: Blockchain Automation Webhook
app.post('/api/webhooks/blockchain-payment', (req, res) => {
  const { txHash, invoiceId } = req.body;

  if (!txHash || !invoiceId) {
    return res.status(400).json({ error: "Missing required parameters: txHash and invoiceId are mandatory" });
  }

  const result = processBlockchainPayment(txHash, invoiceId);
  
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }

  return res.status(200).json({ 
    message: "Payment verified successfully", 
    transaction: result.transaction 
  });
});

// Venture Capital Analytics Dashboard Endpoint
app.get('/api/analytics', (req, res) => {
  res.status(200).json({ 
    company: "CreativePay", 
    metrics: db.analytics 
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
      
