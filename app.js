// ============================================================================
// CONFIG - GLOBAL APPLICATION SETTING RAILS
// ============================================================================
const API_URL = 'https://' + 
  'creative-payroll-infrastructure' + 
  '.onrender.com';

let token = localStorage.getItem('token');
let isLoginMode = true;

// ============================================================================
// UX TOOL: COMPLIANCE STATUS TOAST PIPELINE
// ============================================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.4s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}

// ============================================================================
// SPA ROUTING ENGINE: UPDATE VIEW STATE MAPS CLEANLY
// ============================================================================
function showUIState(viewState) {
  const authSection = document.getElementById('authSection');
  const bvnSection = document.getElementById('bvnSection');
  const dashboard = document.getElementById('dashboard');

  authSection.classList.add('hidden');
  bvnSection.classList.add('hidden');
  dashboard.classList.add('hidden');

  if (viewState === 'auth') {
    authSection.classList.remove('hidden');
  } else if (viewState === 'dashboard') {
    dashboard.classList.remove('hidden');
    loadDashboard();
  } else if (viewState === 'bvn') {
    bvnSection.classList.remove('hidden');
  }
}

// ============================================================================
// PAGE LEVEL INITIALIZER LAYER
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showUIState('dashboard');
  } else {
    showUIState('auth');
  }

  const toggleAuthLink = document.getElementById('toggleAuthLink');
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const verifyBvnBtn = document.getElementById('verifyBvnBtn');
  const fundBtn = document.getElementById('fundBtn');
  const sendBtn = document.getElementById('sendBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (toggleAuthLink) {
    toggleAuthLink.addEventListener('click', (e) => {
      e.preventDefault();
      toggleAuthMode();
    });
  }

  if (loginBtn) loginBtn.addEventListener('click', handleLogin);
  if (registerBtn) registerBtn.addEventListener('click', handleRegister);
  if (verifyBvnBtn) verifyBvnBtn.addEventListener('click', handleBvnVerification);
  if (fundBtn) fundBtn.addEventListener('click', handleFundWallet);
  if (sendBtn) sendBtn.addEventListener('click', handleSendMoney);
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const passField = document.getElementById('password');
      if (passField.type === 'password') {
        passField.type = 'text';
        togglePasswordBtn.innerText = 'Hide';
      } else {
        passField.type = 'password';
        togglePasswordBtn.innerText = 'Show';
      }
    });
  }
});

// ============================================================================
// UI STATE MACHINE: SWAP INTERFACE MODES
// ============================================================================
function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  
  const authTitle = document.getElementById('authTitle');
  const nameGroup = document.getElementById('nameGroup');
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const toggleAuthLink = document.getElementById('toggleAuthLink');
  const errorMsg = document.getElementById('errorMsg');

  errorMsg.innerText = '';

  if (isLoginMode) {
    authTitle.innerText = 'Login';
    nameGroup.classList.add('hidden');
    loginBtn.classList.remove('hidden');
    registerBtn.classList.add('hidden');
    toggleAuthLink.innerText = "Don't have an account? Register";
  } else {
    authTitle.innerText = 'Register Account';
    nameGroup.classList.remove('hidden');
    loginBtn.classList.add('hidden');
    registerBtn.classList.remove('hidden');
    toggleAuthLink.innerText = "Already have an account? Login";
  }
}

// ============================================================================
// HANDLER: CORE USER AUTHENTICATION
// ============================================================================
async function handleLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const loginBtn = document.getElementById('loginBtn');
  const errorMsg = document.getElementById('errorMsg');

  if (!email || !password) {
    errorMsg.innerText = 'Email and password credentials are required.';
    return;
  }

  try {
    setLoadingState(loginBtn, true, 'Authenticating...');
    errorMsg.innerText = '';

    const response = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (data.success) {
      token = data.token;
      localStorage.setItem('token', token);
      showToast('Session verified securely!', 'success');
      showUIState('dashboard');
      clearAuthInputs();
    } else {
      errorMsg.innerText = data.message || 'Login credentials rejected.';
      showToast(data.message || 'Verification rejected', 'error');
    }
  } catch (err) {
    console.error(err);
    errorMsg.innerText = 'Communication link timeout on core infrastructure.';
  } finally {
    setLoadingState(loginBtn, false, 'Login');
  }
}

// ============================================================================
// HANDLER: ONBOARDING ACCREDITATION / REGISTRATION
// ============================================================================
async function handleRegister() {
  const fullName = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const registerBtn = document.getElementById('registerBtn');
  const errorMsg = document.getElementById('errorMsg');

  if (!fullName || !email || !password) {
    errorMsg.innerText = 'All profiling credentials are required to onboard.';
    return;
  }

  try {
    setLoadingState(registerBtn, true, 'Processing Profiling...');
    errorMsg.innerText = '';

    const response = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password })
    });

    const data = await response.json();

    if (data.success) {
      token = data.token;
      localStorage.setItem('token', token);
      showToast('Account setup complete!', 'success');
      showUIState('dashboard');
      clearAuthInputs();
    } else {
      errorMsg.innerText = data.message || 'Onboarding registration failed.';
      showToast(data.message || 'Registration rejected', 'error');
    }
  } catch (err) {
    console.error(err);
    errorMsg.innerText = 'Unable to bind communication network with core rail.';
  } finally {
    setLoadingState(registerBtn, false, 'Register Account');
  }
}

// ============================================================================
// RUNTIME ENGINE: RETRIEVE PORTFOLIO ASSETS & BALANCES
// ============================================================================
async function loadDashboard() {
  if (!token) return;

  try {
    const response = await fetch(`${API_URL}/api/user`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();

    if (data.success) {
      document.getElementById('userDispName').innerText = data.user.name || 'Core Account';
      document.getElementById('userDispEmail').innerText = data.user.email || '';
      document.getElementById('walletId').innerText = data.walletId || 'CP-ALLOCATING';
      
      const kycNode = document.getElementById('kycStatus');
      kycNode.innerText = data.user.kycTier || 'Unverified';
      kycNode.className = data.user.kycTier === 'Verified' ? 'kyc-badge' : 'kyc-pending';

      const b = data.balances || {};
      document.getElementById('balanceNGN').innerText = `₦${parseFloat(b.NGN || 0).toFixed(2)}`;
      document.getElementById('balanceGHS').innerText = `¢${parseFloat(b.GHS || 0).toFixed(2)}`;
      document.getElementById('balanceKES').innerText = `KSh${parseFloat(b.KES || 0).toFixed(2)}`;
      document.getElementById('balanceUSD').innerText = `$${parseFloat(b.USD || 0).toFixed(2)}`;
      document.getElementById('balanceEUR').innerText = `€${parseFloat(b.EUR || 0).toFixed(2)}`;
      document.getElementById('balanceGBP').innerText = `£${parseFloat(b.GBP || 0).toFixed(2)}`;

      loadTransactions();
    } else {
      handleLogout();
    }
  } catch (err) {
    console.error(err);
    showToast('Could not reload dashboard metrics safely', 'error');
  }
}

// ============================================================================
// AUDIT LEDGERS: DISPATCH TRANSACTION SYSTEM HISTORY
// ============================================================================
async function loadTransactions() {
  const transactionList = document.getElementById('transactionList');
  if (!transactionList) return;

  try {
