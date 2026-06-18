const API_URL = ''; // Same origin - THIS IS THE FIX
let currentUser = null;

// UTILITY FUNCTIONS
function showMessage(elementId, message, isError = true) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = `message ${isError ? 'error' : 'success'}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function setLoading(buttonId, isLoading) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'Processing...' : btn.dataset.originalText || 'Submit';
  if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
}

// TOKEN MANAGEMENT
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
    ...(token && { 'Authorization': `Bearer ${token}` })
  };
}

// REGISTER HANDLER - USES CORRECT IDs FROM NEW INDEX.HTML
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoading('regButton', true);

  const userData = {
    name: document.getElementById('name').value,
    email: document.getElementById('email').value,
    password: document.getElementById('password').value,
    phone: document.getElementById('phone').value,
    provider: document.getElementById('provider').value,
    country: document.getElementById('country').value
  };

  try {
    const response = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Registration failed');

    showMessage('regMessage', 'Registration Successful! Please login.', false);
    setTimeout(() => showLogin(), 1500);
    
  } catch (error) {
    showMessage('regMessage', error.message);
  } finally {
    setLoading('regButton', false);
  }
});

// LOGIN HANDLER
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoading('loginButton', true);

  try {
    const response = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');

    setToken(data.token);
    
    if (data.user && data.user.kycStatus === 0) {
      showBVN();
    } else {
      window.location.href = '/dashboard.html';
    }
    
  } catch (error) {
    showMessage('loginMessage', error.message);
  } finally {
    setLoading('loginButton', false);
  }
});

// BVN HANDLER
document.getElementById('bvnForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoading('bvnButton', true);

  const bvn = document.getElementById('bvn').value;
  if (bvn.length !== 11 || !/^\d+$/.test(bvn)) {
    showMessage('bvnMessage', 'BVN must be exactly 11 digits');
    setLoading('bvnButton', false);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/verify-bvn`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ bvn })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'BVN verification failed');

    showMessage('bvnMessage', 'BVN Verified Successfully! Tier 1 Activated.', false);
    setTimeout(() => window.location.href = '/dashboard.html', 1500);
    
  } catch (error) {
    showMessage('bvnMessage', error.message);
  } finally {
    setLoading('bvnButton', false);
  }
});

// KYC GATE - Check on page load
async function checkKYC() {
  const token = getToken();
  if (!token) return;

  try {
    const response = await fetch(`${API_URL}/api/user`, {
      headers: getAuthHeaders()
    });

    if (response.status === 403) {
      const data = await response.json();
      if (data.kycRequired) window.location.href = '/?kyc=required';
    }
  } catch (error) {
    console.error('KYC check failed:', error);
  }
}

// INITIALIZE
document.addEventListener('DOMContentLoaded', () => {
  // Auto-show BVN if redirected from login
  if (window.location.search.includes('kyc=required')) {
    showBVN();
  }
  
  // Check KYC on dashboard
  if (window.location.pathname.includes('dashboard')) {
    checkKYC();
  }
});