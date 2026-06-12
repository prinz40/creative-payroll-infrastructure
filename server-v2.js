import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { db, createInvoice, processBlockchainPayment, AuditLog } from './database-v2.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ENTERPRISE PROXIMAL OVERRIDE FOR RENDER DEPLOYMENTS
app.set('trust proxy', 1); // Automatically instructs Express to fetch true client IPs from Render routing masks

// ENTERPRISE PERIMETER SECURITY HOOKS
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Too many requests from this endpoint. Integrity defense activated." }
});
app.use('/api/', apiRateLimiter);

// Helper function to extract visitor metadata safely
function extractSecurityMetadata(req) {
    return {
        ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'Unknown Browser Signature'
    };
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Index.html'));
});

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: "OPERATIONAL", framework: "Enterprise Perimeter Secure Node" });
});

app.post('/api/invoices', async (req, res) => {
    try {
        const { creativeName, email, amountUSD, targetCurrency } = req.body;
        if (!creativeName || !email || !amountUSD) {
            return res.status(400).json({ error: "Missing required parameters." });
        }
        
        const securityMeta = extractSecurityMetadata(req);
        const invoice = await createInvoice({ creativeName, email, amountUSD, targetCurrency }, securityMeta);
        res.status(201).json({ message: "Invoice created successfully", invoice });
    } catch (err) {
        res.status(500).json({ error: "Internal server error occurred writing to cluster." });
    }
});

app.post('/api/webhooks/blockchain-payment', async (req, res) => {
    try {
        const { txHash, invoiceId } = req.body;
        if (!txHash || !invoiceId) {
            return res.status(400).json({ error: "Missing required parameters." });
        }
        
        const securityMeta = extractSecurityMetadata(req);
        const result = await processBlockchainPayment(txHash, invoiceId, securityMeta);
        
        if (!result.success) {
            return res.status(409).json({ error: result.message });
        }
        
        res.status(200).json({ message: "Payment verified successfully", transaction: result.transaction });
    } catch (err) {
        res.status(500).json({ error: "Internal server error occurred updating cluster transaction space." });
    }
});

app.get('/api/analytics', (req, res) => {
    res.status(200).json({ company: "CreativePay", metrics: db.analytics });
});

// COMPLIANCE ENGINE TIMELINE STREAM ENDPOINT
app.get('/api/audit-trail', async (req, res) => {
    try {
        // Fetch the 10 most recent global compliance events
        const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(10);
        res.status(200).json(logs);
    } catch (err) {
        res.status(500).json({ error: "Failed to extract active audit parameters." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Enterprise Secured Gateway Active: Listening on port ${PORT}`);
});
