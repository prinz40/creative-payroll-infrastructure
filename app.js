// ============================================================================
// CONFIG - GLOBAL APPLICATION SETTING RAILS
// ============================================================================
const API_URL = 'https://onrender.com';
let token = localStorage.getItem('token');
let isLoginMode = true; // Tracks state toggle cleanly

// ============================================================================
// UX TOOL: PROFESSIONAL SNACKBAR / TOAST INFRASTRUCTURE
// ============================================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    console.warn("Toast tracking container not found in DOM");
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);

  // Smooth entry and lifecycle destruction rules
  setTimeout(() => {
    toast.style.transition = 'opacity 0.4s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}

// ============================================================================
// SPA STATE MANAGER: SWITCH VIEW WITHOUT REFRESHING OR 404 BLOCKS
// ============================================================================
function showUIState(viewState) {
  const authSection = document.getElementById('authSection');
  const bvnSection = document.getElementById('bvnSection');
  const dashboard = document.getElementById('dashboard');

  // Hard wipe layout views to standard baseline
  authSection.classList.add('hidden');
  bvnSection.classList.add('hidden');
  dashboard.classList.add('hidden');

  if (viewState === 'auth') {
    authSection.classList.remove('hidden');
  } else if (viewState === 'dashboard') {
    dashboard.classList.remove('hidden');
    loadDashboard(); // Fire account sync logic immediately
  } else if (viewState === 'bvn') {
    bvnSection.classList.remove('hidden');
  }
}

// ============================================================================
// INITIALIZER LAYER: HANDLES DOM EVENTS ON LOAD
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Check baseline session data allocations
  if (token) {
    showUIState('dashboard');
  } else {
    showUIState('auth');
  }

  // Setup Core Elements Form listeners
  const toggleAuthLink = document.getElementById('toggleAuthLink');
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const verifyBvnBtn = document.getElementById('verifyBvnBtn');
  const fundBtn = document.getElementById('fundBtn');
  const sendBtn = document.getElementById('sendBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  // FIXED CORE ACTION BUG: Explicitly handle view switching toggles
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

  // Native password masking/unmasking toggle hook
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
// SUB-ENGINE: TOGGLE AUTH MODE LAYOUT FLOWS
// ============================================================================
function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  
  const authTitle = document.getElementById('authTitle');
  const nameGroup = document.getElementById('nameGroup');
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const toggleAuthLink = document.getElementById('toggleAuthLink');
  const errorMsg = document.getElementById('errorMsg');

  // Dynamic state reset to avoid validation noise leaking over
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
// CORE ENGINE: USER AUTHENTICATION / LOGIN ACTIONS
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
      errorMsg.innerText = data.message || 'Login failed.';
      showToast(data.message || 'Verification rejected', 'error');
    }
  } catch (err) {
    console.error(err);
    errorMsg.innerText = 'Unable to establish link with payment core rail.';
    showToast('Network routing error', 'error');
  } finally {
    setLoadingState(loginBtn, false, 'Login');
  }
}

// ============================================================================
// CORE ENGINE: IDENTITY PROVISIONING / REGISTRATION PIPELINE
// ============================================================================
async function handleRegister() {
  const fullName = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const registerBtn = document.getElementById('registerBtn');
  const errorMsg = document.getElementById('errorMsg');

  if (!fullName || !email || !password) {
    errorMsg.innerText = 'All structural inputs are required to open an account.';
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
      showToast('Account built successfully!', 'success');
      showUIState('dashboard');
      clearAuthInputs();
    } else {
      errorMsg.innerText = data.message || 'Onboarding failed.';
      showToast(data.message || 'Registration dropped', 'error');
    }
  } catch (err) {
    console.error(err);
    errorMsg.innerText = 'Unable to connect to onboarding service.';
    showToast('Infrastructure timeout', 'error');
  } finally {
    setLoadingState(registerBtn, false, 'Register Account');
  }
}

// ============================================================================
// PIPELINE ENGINE: DISPATCH DATA METRICS & SYNC PROFILE DATA
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
      // FIXED ELEMENT VALUE CRASH: Safely reference data tokens into descriptive nodes
      document.getElementById('userDispName').innerText = data.user.name || 'User Node';
      document.getElementById('userDispEmail').innerText = data.user.email || '';
      document.getElementById('walletId').innerText = data.walletId || 'CP-ALLOCATING';
      
      const kycNode = document.getElementById('kycStatus');
      kycNode.innerText = data.user.kycTier || 'Unverified';
      kycNode.className = data.user.kycTier === 'Verified' ? 'kyc-badge' : 'kyc-pending';

      // Load balances safely across mapped currency rails
      const b = data.balances || {};
      document.getElementById('balanceNGN').innerText = `₦${parseFloat(b.NGN || 0).toFixed(2)}`;
      document.getElementById('balanceGHS').innerText = `¢${parseFloat(b.GHS || 0).toFixed(2)}`;
      document.getElementById('balanceKES').innerText = `KSh${parseFloat(b.KES || 0).toFixed(2)}`;
