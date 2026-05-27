const express = require('express');
const app = express();
app.use(express.json());

let invoices = [];

// 1. ENDPOINT: Creative generates a new invoice
app.post('/api/invoices', (req, res) => {
    const { creatorId, amountUsd, localCurrency, creativePhone } = req.body;
        
            if (!creatorId || !amountUsd || !creativePhone) {
                    return res.status(400).json({ error: "Missing required payout parameters." });
                        }

                            const newInvoice = {
                                    invoiceId: `INV-${Math.floor(100000 + Math.random() * 900000)}`,
                                            creatorId,
                                                    amountUsd,
                                                            localCurrency: localCurrency || 'NGN', 
                                                                    creativePhone,
                                                                            status: 'PENDING_PAYMENT',
                                                                                    blockchainTxHash: null
                                                                                        };

                                                                                            invoices.push(newInvoice);
                                                                                                res.status(201).json({ message: "Invoice created successfully", invoice: newInvoice });
                                                                                                });

                                                                                                // 2. ENDPOINT: Webhook simulator for Blockchain payment detection
                                                                                                app.post('/api/webhooks/blockchain-payment', (req, res) => {
                                                                                                    const { invoiceId, txHash, stablecoinAmountSent } = req.body;

                                                                                                        const invoice = invoices.find(i => i.invoiceId === invoiceId);
                                                                                                            if (!invoice) {
                                                                                                                    return res.status(404).json({ error: "Invoice not found in system." });
                                                                                                                        }

                                                                                                                            invoice.status = 'CRYPTO_RECEIVED';
                                                                                                                                invoice.blockchainTxHash = txHash;

                                                                                                                                    console.log(`[SYSTEM LOG]: Crypto received via hash ${txHash}. Initiating local fiat payout...`);
                                                                                                                                        triggerMobileMoneyPayout(invoice);

                                                                                                                                            res.status(200).json({ message: "Payment processed, mobile money payout queued.", invoice });
                                                                                                                                            });

                                                                                                                                            // 3. FUNCTION: Automating the external Mobile Money API routing
                                                                                                                                            function triggerMobileMoneyPayout(invoice) {
                                                                                                                                                console.log(`[PAYOUT AGGREGATOR]: Firing API call to disburse funds to ${invoice.creativePhone}...`);
                                                                                                                                                    invoice.status = 'SETTLED_SUCCESSFULLY';
                                                                                                                                                        console.log(`[SUCCESS]: ${invoice.invoiceId} successfully settled in local currency.`);
                                                                                                                                                        }

                                                                                                                                                        const PORT = 3000;
                                                                                                                                                        app.listen(PORT, () => console.log(`CreativePay Backend active out in the open on port ${PORT}`));
                                                                                                                                                    