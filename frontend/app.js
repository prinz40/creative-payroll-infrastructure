// Configuration: Dynamically switches between local testing and cloud environment
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : window.location.origin;

// Function 1: Fetch and Sync Ledger Metrics from /api/analytics
async function updateDashboardMetrics() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/analytics`);
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        
        if (data && data.metrics) {
            console.log("CreativePay Live Metrics Synced:", data.metrics);
        }
    } catch (error) {
        console.error("Metrics sync fallback activated:", error);
    }
}

// Function 2: Capture Form Inputs and Fire Payload to /api/invoices
async function handlePayloadSubmission() {
    const amountInput = document.querySelector('input[type="number"]');
    const currencySelect = document.querySelector('select');
    const submitButton = document.querySelector('button');

    if (!amountInput || !currencySelect || !submitButton) return;

    const payload = {
        creativeName: "David Mensah",
        email: "david.mensah@creative.io",
        amountUSD: parseFloat(amountInput.value) || 0,
        targetCurrency: currencySelect.value
    };

    try {
        submitButton.disabled = true;
        submitButton.innerText = "Processing Liquidation...";

        const response = await fetch(`${API_BASE_URL}/api/invoices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (response.status === 201) {
            alert(`✅ Settlement Pipeline Initialized for ${payload.targetCurrency}! Invoice created successfully.`);
            updateDashboardMetrics();
        } else {
            alert(`⚠️ Gateway Alert: ${result.error || 'Execution failed'}`);
        }
    } catch (error) {
        alert("❌ Connection setup ready. Link will activate fully once cloud deployment is launched.");
        console.error("Payload execution error:", error);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = `<i class="fa-solid fa-paper-plane text-xs"></i> Fire Settlement Payload`;
    }
}

// Initialize listeners once browser window is fully prepared
document.addEventListener('DOMContentLoaded', () => {
    const actionButton = document.querySelector('button');
    if (actionButton) {
        actionButton.addEventListener('click', handlePayloadSubmission);
    }
    updateDashboardMetrics();
    setInterval(updateDashboardMetrics, 30000);
});
  
