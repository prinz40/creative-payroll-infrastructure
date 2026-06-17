import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, createInvoice, processBlockchainPayment } from './database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production-32chars-min';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// === AUTH MIDDLEWARE ===
function authGuard(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminGuard(req, res, next) {
  if (req.user.role!== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// === UTILITY: AUDIT LOG ===
async function logAudit(eventType, description, req, invoiceId = null) {
  try {
    // Assumes you have a db.audit or similar. Adjust if needed.
    if (db.audit) {
      db.audit.push({
        eventType,
        description,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || 'Unknown',
        userAgent: req.headers['user-agent'] || 'Unknown',
        invoiceId,
        userId: req.user?.userId || null,
        timestamp: new Date()
      });
    }
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// === AUTH ROUTES ===
// Note: You'll need to add user methods to database.js for this to work
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, creativeName, mobileMoneyNumber, mobileMoneyProvider, country } = req.body;

    if (!email ||!password ||!creativeName) {
      return res.status(400).json({ error: 'Email, password, and creativeName are required' });
    }

    // Check if user exists - you'll need to implement findUserByEmail in database.js
    const existing = db.users?.find(u => u.email === email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      id: Date.now().toString(),
      email: email.toLowerCase(),
      password: hashedPassword,
      creativeName,
      mobileMoneyNumber,
      mobileMoneyProvider,
      country: country || 'NGN',
      role: 'creator',
      createdAt: new Date()
    };

    // Add to db - you'll need to implement addUser in database.js
    if (!db.users) db.users = [];
    db.users.push(user);

    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    await logAudit('USER_REGISTERED', `New user ${email} created account`, req);

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, creativeName: user.creativeName, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.users?.find(u => u.email === email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    await logAudit('USER_LOGIN', `User ${email} logged in`, req);

    res.json({
      token,
      user: { id: user.id, email: user.email, creativeName: user.creativeName, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PREMIUM INTERFACE ROUTE ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Index.html'));
});

// === TIER 1: HEALTH CHECK ===
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: "OPERATIONAL" });
});

// === TIER 2: INVOICES PIPELINE - NOW PROTECTED ===
app.post('/api/invoices', authGuard, async (req, res) => {
  try {
    const { creativeName, email, amountUSD, targetCurrency } = req.body;

    if (!creativeName ||!email ||!amountUSD) {
      return res.status(400).json({ error: "Missing required parameters: creativeName, email, and amountUSD are mandatory" });
    }

    const invoice = await createInvoice({
      creativeName,
      email,
      amountUSD,
      targetCurrency,
      userId: req.user.userId // Tie invoice to logged in user
    });

    await logAudit('INVOICE_CREATED', `Invoice for $${amountUSD} ${targetCurrency} created`, req, invoice.id);
    res.status(201).json({ message: "Invoice created successfully", invoice });
  } catch (err) {
    res.status(500).json({ error: "Internal server error occurred writing to cluster" });
  }
});

// Get user invoices - NEW ENDPOINT
app.get('/api/invoices', authGuard, async (req, res) => {
  try {
    const userInvoices = db.invoices?.filter(inv => inv.userId === req.user.userId) || [];
    res.json(userInvoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === TIER 3 & 4: BLOCKCHAIN WEBHOOK - NOW PROTECTED ===
app.post('/api/webhooks/blockchain-payment', authGuard, async (req, res) => {
  try {
    const { txHash, invoiceId } = req.body;

    if (!txHash ||!invoiceId) {
      return res.status(400).json({ error: "Missing required parameters: txHash and invoiceId are mandatory" });
    }

    const result = await processBlockchainPayment(txHash, invoiceId);

    if (!result.success) {
      if (result.message.includes('already')) {
        await logAudit('ATTACK_BLOCKED', `Duplicate settlement attempt blocked for ${invoiceId}`, req, invoiceId);
        return res.status(409).json({ error: result.message });
      }
      return res.status(400).json({ error: result.message });
    }

    await logAudit('PAYMENT_SETTLED', `Invoice ${invoiceId} settled with tx ${txHash}`, req, invoiceId);
    return res.status(200).json({
      message: "Payment verified successfully",
      transaction: result.transaction
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error occurred updating cluster transaction space" });
  }
});

// === AUDIT TRAIL - NOW PROTECTED ===
app.get('/api/audit-trail', authGuard, async (req, res) => {
  try {
    const logs = db.audit?.filter(log => log.userId === req.user.userId).slice(-50) || [];
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ANALYTICS - ADMIN ONLY ===
app.get('/api/analytics', authGuard, adminGuard, (req, res) => {
  res.status(200).json({
    company: "CreativePay",
    metrics: db.analytics || {}
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});