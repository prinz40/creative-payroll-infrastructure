import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db, createInvoice, processBlockchainPayment } from './database.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Tier 1: Health
app.get('/api/health', (req, res) => {
  res.status(200).json({
      status: "OPERATIONAL",
          timestamp: new Date().toISOString()
            });
            });

            // Tier 2: Invoices
            app.post('/api/invoices', (req, res) => {
              const { creativeName, email, amountUSD, targetCurrency } = req.body;
                if (!creativeName || !email || !amountUSD) {
                    return res.status(400).json({ error: "Missing parameters" });
                      }
                        const invoice = createInvoice({ creativeName, email, amountUSD, targetCurrency });
                          res.status(201).json({ message: "Invoice created successfully.", invoice });
                          });

                          // Tier 3 & 4: Blockchain Webhook
                          app.post('/api/webhooks/blockchain-payment', (req, res) => {
                            const { txHash, invoiceId } = req.body;
                              if (!txHash || !invoiceId) {
                                  return res.status(400).json({ error: "Missing parameters" });
                                    }
                                      const result = processBlockchainPayment(txHash, invoiceId);
                                        if (!result.success) {
                                            return res.status(400).json({ error: result.message });
                                              }
                                                res.status(200).json({ message: "Payment verified.", transaction: result.transaction });
                                                });

                                                // VC Dashboard Analytics
                                                app.get('/api/analytics', (req, res) => {
                                                  res.status(200).json({
                                                      company: "CreativePay Infrastructure",
                                                          monetization: "1% flat fee",
                                                              metrics: db.analytics,
                                                                  activeInvoices: db.invoices,
                                                                      ledgerHistory: db.transactions
                                                                        });
                                                                        });

                                                                      app.listen(PORT, () => {
                                                                          console.log(`🚀 Engine running on port ${PORT}`);
                                                                          });