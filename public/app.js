// ===================
// CONFIG - RELATIVE PATH FOR RENDER
// ===================
const API_URL = ''; // Empty means use same domain. This fixes CORS + localhost issues

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
      return res; // Success, return immediately
    } catch (err) {
      clearTimeout(timeoutId);
      if (i === retries || err.name !== 'AbortError') throw err; // Last try or not timeout = throw
      await new Promise(r => setTimeout(r, delay)); // Wait 3s then retry
    }
  }
}

// ===================
// REGISTER FUNCTION - WAS MISSING
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
      window.location.href = '/?kyc=required'; // Go to BVN page first
    } else {
      errorMsg.textContent = data.message || 'Registration failed';
    }
  } catch (error) {
    errorMsg.textContent = 'Network error. Please try again.';
  }
}

// ===================
// LOGIN FUNCTION - FIXED
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

      // FIX: Backend uses 'unverified' lowercase
      if (data.user.kycStatus === 'unverified') {
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
// KYC BVN VERIFICATION - FIXED ROUTE
// ===================
async function verifyBVN() {
  const bvnInput = document.getElementById('bvnInput');
  const bvnError = document.getElementById('bvnError');
  const bvnSuccess = document.getElementById('bvnSuccess');
  const verifyBtn = document.getElementById('verifyBvnBtn');

  const bvn = bvnInput.value.trim();
  const token = localStorage.getItem('token');

  bvnError.style.display = 'none';
  bvnSuccess.style.display = 'none';

  if (!bvn || !/^\d{11}$/.test(bvn)) { // Backend only accepts 11 digits
    bvnError.textContent = 'BVN must be 11 digits';
    bvnError.style.display = 'block';
    return;
  }

  if (!token) {
    bvnError.textContent = 'Session expired. Please login again.';
    bvnError.style.display = 'block';
    return;
  }

  verifyBtn.textContent = 'Processing...';
  verifyBtn.disabled = true;

  try {
    // FIX: Route is /api/bvn not /api/kyc/verify-bvn
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
      localStorage.setItem('user', JSON.stringify(data.user));

      setTimeout(() => {
        window.location.href = '/';
      }, 2000);

    } else {
      bvnError.textContent = data.message || 'Verification failed';
      bvnError.style.display = 'block';
    }

  } catch (error) {
    console.error('BVN error:', error);
    if (error.name === 'AbortError') {
      bvnError.textContent = 'Server waking up. Please tap Verify again in 5s.';
    } else {
      bvnError.textContent = `Request failed: ${error.message}`;
    }
    bvnError.style.display = 'block';
  } finally {
    verifyBtn.textContent = 'Verify BVN';
    verifyBtn.disabled = false;
  }
}
