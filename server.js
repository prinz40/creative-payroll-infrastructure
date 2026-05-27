import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db, createInvoice, processBlockchainPayment } from './database.js';

// Initialize Environment Variables and App
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware Layers
app.use(cors());
app.use(express.json());

// --- Tier 1: Core System API Health Check ---
app.get('/api/health', (req, res) => {
  res.status(200).json({
      status: "OPERATIONAL",
          infrastructure: "CreativePay Core Infrastructure Engine",
              timestamp: new Date().toISOString()
                });
                });

                // --- Tier 2: Invoicing Deployment Pipeline ---
                app.post('/api/invoices', (req, res) => {
                  const { creativeName, email, amountUSD, targetCurrency } = req.body;

                    if (!creativeName || !email || !amountUSD) {
                        return res.status(400).json({ 
                              error: "Missing required payroll parameters: creativeName, email, amountUSD" 
                                  });
                                    }

                                      const invoice = createInvoice({ creativeName, email, amountUSD, targetCurrency });
                                        res.status(201).json({
                                            message: "Global invoice created successfully. Awaiting stablecoin settlement.",
                                                invoice
                                                  });
                                                  });

                                                  // --- Tier 3 & 4: Blockchain Automation & Mobile Money Liquidation Gateway ---
                                                  app.post('/api/webhooks/blockchain-payment', (req, res) => {
                                                    const { txHash, invoiceId } = req.body;

                                                      if (!txHash || !invoiceId) {
                                                          return res.status(400).json({ 
                                                                error: "Missing required validation parameters: txHash, invoiceId" 
                                                                    });
                                                                      }

                                                                        const calculationResult = processBlockchainPayment(txHash, invoiceId);

                                                                          if (!calculationResult.success) {
                                                                              return res.status(400).json({ error: calculationResult.message });
                                                                                }

                                                                                  res.status(200).json({
                                                                                      message: "Stablecoin payment verified. Funds converted and queued for mobile money distribution.",
                                                                                          transaction: calculationResult.transaction
                                                                                            });
                                                                                            });

                                                                                            // --- Venture Capital & Investor Metrics Tracking Dashboard Endpoint ---
                                                                                            app.get('/api/analytics', (req, res) => {
                                                                                              res.status(200).json({
                                                                                                  company: "CreativePay Infrastructure",
                                                                                                      monetizationModel: "1% flat cross-border settlement fee",
                                                                                                          metrics: db.analytics,
                                                                                                              activeInvoices: db.invoices,
                                                                                                                  ledgerHistory: db.transactions
                                                                                                                    });
                                                                                                                    });

                                                                                                                    // Start Server Listen Execution Loop
                                                                                                                    app.listen(PORT, () => {
                                                                                                                      console.log(`🚀 CreativePay Engine running on port ${PORT}`);
                                                                                                                      });