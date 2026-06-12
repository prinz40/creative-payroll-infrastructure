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
            const metricWindow = document.getElementById("output-window");
            if (metricWindow) {
                metricWindow.innerText = JSON.stringify(data, null, 2);
            }
        }
    } catch (error) {
        console.error("Metrics sync fallback activated:", error);
    }
}

// Function 2: Update the Global Payout UI components dynamically
export function populatePayoutLedger(txData) {
    if (!txData) return;
    
    document.getElementById("ledger-status").innerText = "SETTLED / ASSETS DISBURSED";
    document.getElementById("ledger-status").style.color = "#2ecc71";
    document.getElementById("ledger-gross").innerText = `$${txData.grossUSD.toFixed(2)} USD`;
    document.getElementById("ledger-fee").innerText = `$${txData.platformFeeUSD.toFixed(2)} USD`;
    document.getElementById("ledger-net").innerText = `$${txData.netUSD.toFixed(2)} USD`;
    document.getElementById("ledger-payout").innerText = txData.payoutLocal;
}

// Initialize listeners once browser window is fully prepared
document.addEventListener('DOMContentLoaded', () => {
    updateDashboardMetrics();
    // Auto refresh infrastructure metrics every 30 seconds
    setInterval(updateDashboardMetrics, 30000);
});
