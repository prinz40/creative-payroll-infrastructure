// ===================
// CONFIG - POINT TO BACKEND ON RENDER
// ===================
const API_URL = 'https://creative-payroll-infrastructure.onrender.com'; // ✅ FIXED: This is your backend URL
const token = localStorage.getItem('token');

// ===================
// HELPER: FETCH WITH TIMEOUT + RETRY FOR RENDER COLD START
// ===================
async function fetchWithRetry(url, options, retries = 2, delay = 3000) {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (i === retries || err.name !== 'AbortError') throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ===================
// ON PAGE LOAD: CHECK SUCCESS ALERT + LOAD DASHBOARD
// ===================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Check for success alert from Paystack
  const params = new URLSearchParams(window.location.search);
  if(params.get('success') === 'true'){
    const amount = params.get('amount');
    const currency = params.get('currency');
    alert(`✅ Wallet funded successfully!\nNew ${currency} Balance: ${amount} added`);
    // Clean URL
    window.history.replaceState({}, document.title, "/");
  }
  if(params.get('success') === 'false'){
    alert('❌ Payment failed. Please try again.');
    window.history.replaceState({}, document.title, "/");
  }

  // 2. Load dashboard if logged in
  if(token && document.getElementById('dashboard')){
    loadDashboard();
  }
});

// ===================
// LOAD DASHBOARD DATA - RESTORED FROM OLD APP
// ===================
async function loadDashboard() {
  try {
    const res = await fetchWithRetry(`${API_URL}/api/user`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if(data.success){
      const user = data.user;
      // Show old app fields
      document.getElementById('fullName').textContent = user.fullName;
      document.getElementById('email').textContent = user.email;
      document.getElementById('walletId').textContent = user.walletId; // ✅ RESTORED
      document.getElementById('kycStatus').textContent = user.kycTier === 1 ? 'KYC TIER 1 VERIFIED' : 'UNVERIFIED';

      // Show multi-currency balances
      document.getElementById('balanceNGN').textContent = `₦${user.balances.NGN.toFixed(2)}`;
      document.getElementById('balanceGHS').textContent = `GH₵${user.balances.GHS.toFixed(2)}`;
      document.getElementById('balanceKES').textContent = `KSh${user.balances.KES.toFixed(2)}`;
      document.getElementById('balanceUSD').textContent = `$${user.balances.USD.toFixed(2)}`;
      document.getElementById('balanceEUR').textContent = `€${user.balances.EUR.toFixed(2)}`;
      document.getElementById('balanceGBP').textContent = `£${user.balances.GBP.toFixed(2)}`;

      loadTransactions();
    }
  } catch(e){
    console.error(e);
  }
}

// ===================
// REGISTER FUNCTION
// ===================
async function register() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const fullName = document.getElementById('fullName').value;
  const errorMsg = document.getElementById('errorMsg');

  try {
    const response = await fetchWithRetry(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName })
    });
    const data = await response.json();
    if (response.ok && data.success) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/?kyc=required';
    } else {
      errorMsg.textContent = data.message || 'Registration failed';
    }
  } catch (error) {
    errorMsg.textContent = 'Network error. Please try again.';
  }
}

// ===================
// LOGIN FUNCTION
// ===================
async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');
  try {
    const response = await fetchWithRetry(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (response.ok && data.success) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      if (data.user.kycTier === 0) {
        window.location.href = '/?kyc=required';
      } else {
        window.location.href = '/';
      }
    } else {
      errorMsg.textContent = data.message || 'Login failed';
    }
  } catch (error) {
    errorMsg.textContent = 'Network error. Please try again.';
  }
}

// ===================
// FUND WALLET - RESTORED + MULTI-CURRENCY
// ===================
async function fundWallet() {
  const amount = document.getElementById('fundAmount').value;
  const currency = document.getElementById('fundCurrency').value || 'NGN';
  const errorMsg = document.getElementById('fundError');

  if(!amount || amount < 100) {
    errorMsg.textContent = 'Minimum funding is 100';
    return;
  }

  try {
    const res = await fetchWithRetry(`${API_URL}/api/wallet/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ amount, currency })
    });
    const data = await res.json();
    if(data.success){
      window.location.href = data.authorization_url; // Go to Paystack
    } else {
      errorMsg.textContent = data.message;
    }
  } catch(e){
    errorMsg.textContent = 'Payment failed. Try again.';
  }
}

// ===================
// SEND MONEY - WALLETID OR EMAIL
// ===================
async function sendMoney() {
  const recipient = document.getElementById('recipient').value; // email or walletId
  const amount = document.getElementById('sendAmount').value;
  const currency = document.getElementById('sendCurrency').value || 'NGN';
  const narration = document.getElementById('narration').value;
  const errorMsg = document.getElementById('sendError');

  try {
    const res = await fetchWithRetry(`${API_URL}/api/wallet/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ recipient, amount, currency, narration })
    });
    const data = await res.json();
    if(data.success){
      alert('✅ ' + data.message);
      loadDashboard(); // Refresh balance
    } else {
      errorMsg.textContent = data.message;
    }
  } catch(e){
    errorMsg.textContent = 'Transfer failed. Try again.';
  }
}

// ===================
// KYC BVN VERIFICATION
// ===================
async function verifyBVN() {
  const bvnInput = document.getElementById('bvnInput');
  const bvnError = document.getElementById('bvnError');
  const bvnSuccess = document.getElementById('bvnSuccess');
  const verifyBtn = document.getElementById('verifyBvnBtn');
  const bvn = bvnInput.value.trim();

  bvnError.style.display = 'none';
  bvnSuccess.style.display = 'none';

  if (!bvn || !/^\d{11}$/.test(bvn)) {
    bvnError.textContent = 'BVN must be 11 digits';
    bvnError.style.display = 'block';
    return;
  }

  verifyBtn.textContent = 'Processing...';
  verifyBtn.disabled = true;

  try {
    const response = await fetchWithRetry(`${API_URL}/api/bvn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bvn })
    });
    const data = await response.json();
    if (response.ok && data.success === true) {
      bvnSuccess.textContent = 'BVN Verified!';
      bvnSuccess.style.display = 'block';
      setTimeout(() => { window.location.href = '/'; }, 2000);
    } else {
      bvnError.textContent = data.message || 'Verification failed';
      bvnError.style.display = 'block';
    }
  } catch (error) {
    bvnError.textContent = `Request failed: ${error.message}`;
    bvnError.style.display = 'block';
  } finally {
    verifyBtn.textContent = 'Verify BVN';
    verifyBtn.disabled = false;
  }
}

// ===================
// LOAD TRANSACTION HISTORY
// ===================
async function loadTransactions() {
  const container = document.getElementById('transactionList');
  if(!container) return;
  try {
    const res = await fetchWithRetry(`${API_URL}/api/transactions`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if(data.success){
      container.innerHTML = data.transactions.map(txn => `
        <div class="txn">
          <p><b>${txn.type}</b> ${txn.status === 'success' ? '+' : '-'}${txn.currency} ${txn.amount}</p>
          <small>${new Date(txn.createdAt).toLocaleString()}</small>
        </div>
      `).join('');
    }
  } catch(e){ console.error(e) }
}