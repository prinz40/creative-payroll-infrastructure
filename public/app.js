// Configuration: Dynamically switches between local testing and cloud environment
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://localhost:3000' 
  : window.location.origin;

// ======================
// UTILITY: TOKEN MANAGEMENT
// ======================
function getToken() {
  return localStorage.getItem('creativepay_token');
}

function setToken(token) {
  localStorage.setItem('creativepay_token', token);
}

function clearToken() {
  localStorage.removeItem('creativepay_token');
}

function getAuthHeaders() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
}

// ======================
// FUNCTION 1: LOGIN
// ======================
async function loginUser(email, password) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) throw new Error(data.error || 'Login failed');
    
    setToken(data.token);
    
    // Check KYC status immediately after login
    if (data.user.kycStatus === 'unverified') {
      window.location.href = '/verify-bvn'; // Redirect to BVN form
    } else {
      window.location.href = '/dashboard.html'; // Go to dashboard
    }
    
    return data;
  } catch (error) {
    console.error('Login error:', error);
    alert(error.message);
  }
}

// ======================
// FUNCTION 2: FETCH PROFILE WITH KYC GATE
// ======================
async function fetchUserProfile() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/profile`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    
    const data = await response.json();
    
    // KYC GATE: Catch 403 from backend
    if (response.status === 403 && data.kycStatus === 'unverified') {
      console.log('KYC Required. Redirecting to BVN verification...');
      window.location.href = '/verify-bvn'; // Force BVN screen
      return null;
    }
    
    if (!response.ok) throw new Error(data.error || 'Failed to fetch profile');
    
    // User is verified - update dashboard
    console.log('User verified:', data);
    document.getElementById('user-name').innerText = data.name;
    document.getElementById('user-balance').innerText = `₦${data.balance.toLocaleString()}`;
    document.getElementById('kyc-badge').innerHTML = `Tier ${data.kycTier} Verified ✓`;
    document.getElementById('kyc-badge').style.color = '#2ecc71';
    
    return data;
  } catch (error) {
    console.error('Profile fetch error:', error);
    // If token invalid, force re-login
    if (error.message.includes('token')) {
      clearToken();
      window.location.href = '/';
    }
  }
}

// ======================
// FUNCTION 3: SUBMIT BVN - TIER 1 VERIFICATION
// ======================
async function submitBVN(bvn) {
  try {
    // Basic frontend validation
    if (!bvn || bvn.length !== 11 || !/^\d+$/.test(bvn)) {
      throw new Error('BVN must be exactly 11 digits');
    }
    
    const response = await fetch(`${API_BASE_URL}/api/kyc/verify-bvn`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ bvn })
    });
    
    const data = await response.json();
    
    if (!response.ok) throw new Error(data.error || 'BVN verification failed');
    
    alert('BVN Verified Successfully! Tier 1 Activated.');
    window.location.href = '/dashboard.html'; // Unlock dashboard
    
    return data;
  } catch (error) {
    console.error('BVN verification error:', error);
    alert(error.message);
  }
}

// ======================
// FUNCTION 4: FETCH ANALYTICS - YOUR EXISTING CODE
// ======================
async function updateDashboardMetrics() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/analytics`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error('Network response was not ok');
    
    const data = await response.json();
    if (data && data.metrics) {
      console.log("CreativePay Live Metrics Synced:", data.metrics);
      const metricWindow = document.getElementById('output-window');
      if (metricWindow) {
        metricWindow.innerText = JSON.stringify(data, null, 2);
      }
    }
  } catch (error) {
    console.error("Metrics sync fallback activated:", error);
  }
}

// ======================
// FUNCTION 5: UPDATE PAYOUT LEDGER - YOUR EXISTING CODE
// ======================
export function populatePayoutLedger(txData) {
  if (!txData) return;
  
  document.getElementById('ledger-status').innerText = "SETTLED / ASSETS DISBURSED";
  document.getElementById('ledger-status').style.color = "#2ecc71";
  document.getElementById('ledger-gross').innerText = `$${txData.grossUSD.toFixed(2)} USD`;
  document.getElementById('ledger-fee').innerText = `$${txData.platformFeeUSD.toFixed(2)} USD`;
  document.getElementById('ledger-net').innerText = `$${txData.netUSD.toFixed(2)} USD`;
  document.getElementById('ledger-payout').innerText = txData.payoutLocal;
}

// ======================
// INITIALIZE LISTENERS
// ======================
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  
  // If on dashboard, fetch profile + metrics
  if (path.includes('dashboard.html')) {
    fetchUserProfile(); // This has the KYC gate
    updateDashboardMetrics();
    setInterval(updateDashboardMetrics, 30000); // Auto refresh every 30s
  }
  
  // Attach login form handler
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      loginUser(email, password);
    });
  }
  
  // Attach BVN form handler
  const bvnForm = document.getElementById('bvn-form');
  if (bvnForm) {
    bvnForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const bvn = document.getElementById('bvn-input').value;
      submitBVN(bvn);
    });
  }
});