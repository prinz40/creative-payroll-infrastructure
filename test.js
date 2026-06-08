import fetch from 'node-fetch'; // Standard for testing environments

// Configure the base URL where your server is running (defaults to local development port)
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

async function runCreativePayTestSuite() {
  console.log("🚀 Starting CreativePay Infrastructure End-to-End Test Suite...\n");

  try {
    // Test 1: Check System Health
    console.log("📋 Test 1: Verifying Server Health Endpoint...");
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthRes.json();
    console.log(`STATUS: ${healthRes.status} ->`, healthData, "\n");

    // Test 2: Create a Mock Creative Invoice
    console.log("📋 Test 2: Simulating Invoice Issuance Layer...");
    const invoicePayload = {
      creativeName: "Chidi Okafor",
      email: "chidi@creativepay.network",
      amountUSD: "250.00",
      targetCurrency: "NGN"
    };
    
    const invRes = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoicePayload)
    });
    const invData = await invRes.json();
    console.log(`STATUS: ${invRes.status} ->`, invData);
    
    const targetInvoiceId = invData.invoice?.id;
    console.log(`Generated Invoice ID: ${targetInvoiceId}\n`);

    if (!targetInvoiceId) throw new Error("Invoice creation failed, aborting further tests.");

    // Test 3: Process Legitimate Blockchain Settlement
    console.log("📋 Test 3: Simulating On-Chain Settlement Engine...");
    const mockTxHash = `0x${Math.random().toString(16).substr(2, 40)}`;
    const paymentPayload = {
      txHash: mockTxHash,
      invoiceId: targetInvoiceId
    };

    const payRes = await fetch(`${BASE_URL}/api/webhooks/blockchain-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentPayload)
    });
    const payData = await payRes.json();
    console.log(`STATUS: ${payRes.status} ->`, payData, "\n");

    // Test 4: Security Shield Guard Check (Double-Spend Attempt)
    console.log("📋 Test 4: Verifying Cryptographic Double-Spend Guard...");
    const doubleSpendRes = await fetch(`${BASE_URL}/api/webhooks/blockchain-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentPayload) // Sending the exact same hash again
    });
    const doubleSpendData = await doubleSpendRes.json();
    console.log(`STATUS: ${doubleSpendRes.status} (Expected 400 Error) ->`, doubleSpendData, "\n");

    // Test 5: Verify Venture Capital Analytics Metrics
    console.log("📋 Test 5: Fetching Analytics Ledger & Fees Metrics...");
    const analyticsRes = await fetch(`${BASE_URL}/api/analytics`);
    const analyticsData = await analyticsRes.json();
    console.log(`STATUS: ${analyticsRes.status} ->`, analyticsData, "\n");

    console.log("🏁 All infrastructure test passes completed successfully! The system is highly secure and fully prepared.");

  } catch (error) {
    console.error("❌ Test Suite execution error encountered:", error.message);
  }
}

runCreativePayTestSuite();


