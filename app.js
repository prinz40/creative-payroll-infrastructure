// ===================
// CONFIG - BACKEND ON RENDER
// ===================
const API_URL = 'https://creative-payroll-infrastructure.onrender.com'; 
const token = localStorage.getItem('token');

// ===================
// HELPER: SHOW TOAST ALERTS INSTEAD OF ALERT()
// ===================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ===================
// HELPER: FETCH WITH TIMEOUT + RETRY FOR RENDER COLD START
// ===================
async function fetchWithRetry(url, options, retries = 2, delay = 3000) {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); 
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      
      // Auto logout if token expired
      if(res.status === 401) {
        localStorage.clear();
        window.location.href = '/login.html';
        return;
      }
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (i === retries) {
        showToast('Network error. Server might be waking up. Please try again.', 'error');
        throw err;
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ===================
// ON PAGE LOAD
// ===================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Payment success/fail alert
  const params = new URLSearchParams(window.location.search);
  if(params.get('success') === 'true'){
    const amount = params.get('amount');
    const currency = params.get('currency');
    showToast(`Wallet funded successfully! ${currency} ${amount} added`, 'success');
    window.history.replaceState({}, document.title, "/");
  }
  if(params.get('success') === 'false'){
    showToast('Payment failed. Please try again.', 'error');
    window.history.replaceState({}, document.title, "/");
  }

  // 2. Protect routes
  const protectedPages = ['/', '/dashboard.html'];
  if(!token && protectedPages.includes(window.location.pathname)){
    window.location.href = '/login.html';
  }

  // 3. Load dashboard if logged in
  if(token && document.getElementById('dashboard')){
    loadDashboard();
  }

  // 4. Attach event listeners to buttons
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const fundBtn = document.getElementById('fundBtn');
  const sendBtn = document.getElementById('sendBtn');
  const verifyBvnBtn = document.getElementById('verifyBvnBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if(loginBtn) loginBtn.addEventListener('click', login);
  if(registerBtn) registerBtn.addEventListener('click', register);
  if(fundBtn) fundBtn.addEventListener('click', fundWallet);
  if(sendBtn) sendBtn.addEventListener('click', sendMoney);
  if(verifyBvnBtn) verifyBvnBtn.addEventListener('click', verifyBVN);
  if(logoutBtn) logoutBtn.addEventListener('click', logout);
});

// ===================
// LOGOUT
// ===================
function logout() {
  localStorage.clear();
  showToast('Logged out successfully', 'success');
  setTimeout(() => window.location.href = '/login.html', 1000);
}

// ===================
// LOAD DASHBOARD DATA
// ===================
async function loadDashboard() {
  try {
    const res = await fetchWithRetry(`${API_URL}/api/user`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if(data.success){
      const user = data.user;
      document.getElementById('fullName').textContent = user.fullName || 'N/A';
      document.getElementById('email').textContent = user.email || 'N/A';
      document.getElementById('walletId').textContent = user.walletId || 'N/A'; 
      document.getElementById('kycStatus').textContent = user.kycTier === 1 ? 'KYC TIER 1 VERIFIED' : 'UNVERIFIED';

      // Multi-currency balances with safety check
      document.getElementById('balanceNGN').textContent = `₦${(user.balances?.NGN || 0).toFixed(2)}`;
      document.getElementById('balanceGHS').textContent = `GH₵${(user.balances?.GHS || 0).toFixed(2)}`;
      document.getElementById('balanceKES').textContent = `KSh${(user.balances?.KES || 0).toFixed(2)}`;
      document.getElementById('balanceUSD').textContent = `$${(user.balances?.USD || 0).toFixed(2)}`;
      document.getElementById('balanceEUR').textContent = `€${(user.balances?.EUR || 0).toFixed(2)}`;
      document.getElementById('balanceGBP').textContent = `£${(user.balances?.GBP || 0).toFixed(2)}`;

      loadTransactions();
    } else {
      showToast(data.message || 'Failed to load dashboard', 'error');
    }
  } catch(e){
    console.error(e);
    showToast('Could not load dashboard', 'error');
  }
}

// ===================
// REGISTER
// ===================
async function register() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const fullName = document.getElementById('fullName').value.trim();
  const errorMsg = document.getElementById('errorMsg');

  if(!email || !password || !fullName) {
    errorMsg.textContent = 'All fields are required';
    return;
  }

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
      showToast('Registration successful!', 'success');
      setTimeout(() => window.location.href = '/?kyc=required', 1000);
    } else {
      errorMsg.textContent = data.message || 'Registration failed';
    }
  } catch (error) {
    errorMsg.textContent = 'Network error. Please try again.';
  }
}

// ===================
// LOGIN
// ===================
async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');

  if(!email || !password) {
    errorMsg.textContent = 'Email and password required';
    return;
  }

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
      showToast('Login successful!', 'success');
      setTimeout(() => {
        window.location.href = data.user.kycTier === 0 ? '/?kyc=required' : '/';
      }, 1000);
    } else {
      errorMsg.textContent = data.message || 'Login failed';
    }
  } catch (error) {
    errorMsg.textContent = 'Network error. Please try again.';
  }
}

// ===================
// FUND WALLET
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
      body: JSON.stringify({ amount: Number(amount), currency })
    });
    const data = await res.json();
    if(data.success){
      window.location.href = data.authorization_url; 
    } else {
      errorMsg.textContent = data.message;
    }
  } catch(e){
    errorMsg.textContent = 'Payment failed. Try again.';
  }
}

// ===================
// SEND MONEY
// ===================
async function sendMoney() {
  const recipient = document.getElementById('recipient').value.trim(); 
  const amount = document.getElementById('sendAmount').value;
  const currency = document.getElementById('sendCurrency').value || 'NGN';
  const narration = document.getElementById('narration').value;
  const errorMsg = document.getElementById('sendError');

  if(!recipient || !amount) {
    errorMsg.textContent = 'Recipient and amount required';
    return;
  }

  try {
    const res = await fetchWithRetry(`${API_URL}/api/wallet/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ recipient, amount: Number(amount), currency, narration })
    });
    const data = await res.json();
    if(data.success){
      showToast(data.message, 'success');
      loadDashboard(); 
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
      container.innerHTML = data.transactions.length > 0 
        ? data.transactions.map(txn => `
          <div class="txn">
            <p><b>${txn.type}</b> ${txn.status === 'success' ? '+' : '-'}${txn.currency} ${txn.amount}</p>
            <small>${new Date(txn.createdAt).toLocaleString()}</small>
          </div>
        `).join('')
        : '<p>No transactions yet</p>';
    }
  } catch(e){ console.error(e) }
                                }
