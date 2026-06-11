import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { db, createInvoice, processBlockchainPayment } from './database-v2.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ENTERPRISE PERIMETER SECURITY HOOKS
app.use(helmet({
    contentSecurityPolicy: false // Allows the dashboard frontend to connect without rigid asset blocks during staging
}));

app.use(cors());
app.use(express.json());

// API Flood Defense - Rate Limiter
const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15-minute verification window
    max: 100, // Caps endpoints at 100 requests per window per IP
    message: { error: "Too many requests from this endpoint. Integrity defense activated." }
});
app.use('/api/', apiRateLimiter);

// Premium Interface Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Index.html')); // Fixed case sensitivity to match Index.html
});

// Tier 1: Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: "OPERATIONAL", framework: "Enterprise Perimeter Secure Node" });
});

// Tier 2: Invoices Pipeline Endpoint
app.post('/api/invoices', async (req, res) => {
    try {
        const { creativeName, email, amountUSD, targetCurrency } = req.body;
        
        if (!creativeName || !email || !amountUSD) {
            return res.status(400).json({ error: "Missing required parameters: creativeName, email, and amountUSD are mandatory." });
        }
        
        const invoice = await createInvoice({ creativeName, email, amountUSD, targetCurrency });
        res.status(201).json({ message: "Invoice created successfully", invoice });
    } catch (err) {
        res.status(500).json({ error: "Internal server error occurred writing to cluster." });
    }
});

// Tier 3 & 4: Blockchain Automation Webhook Gateway
app.post('/api/webhooks/blockchain-payment', async (req, res) => {
    try {
        const { txHash, invoiceId } = req.body;
        
        if (!txHash || !invoiceId) {
            return res.status(400).json({ error: "Missing required parameters: txHash and invoiceId are mandatory." });
        }
        
        const result = await processBlockchainPayment(txHash, invoiceId);
        
        if (!result.success) {
            // Return crisp, structured enterprise business rule errors instead of throwing system crashes
            return res.status(409).json({ error: result.message });
        }
        
        res.status(200).json({
            message: "Payment verified successfully",
            transaction: result.transaction
        });
    } catch (err) {
        res.status(500).json({ error: "Internal server error occurred updating cluster transaction space." });
    }
});

// Venture Capital Analytics Dashboard Endpoint
app.get('/api/analytics', (req, res) => {
    res.status(200).json({
        company: "CreativePay",
        metrics: db.analytics
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Enterprise Secured Gateway Active: Listening on port ${PORT}`);
});
        
