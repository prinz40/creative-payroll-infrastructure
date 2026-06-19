// ===================
// CONFIG
// ===================
const API_URL = 'https://creative-payroll-infrastructure.onrender.com';

// ===================
// KYC BVN VERIFICATION - UPDATED URL
// ===================
async function verifyBVN() {
  const bvnInput = document.getElementById('bvnInput');
  const bvnError = document.getElementById('bvnError');
  const bvnSuccess = document.getElementById('bvnSuccess');
  const verifyBtn = document.getElementById('verifyBvnBtn');

  const bvn = bvnInput.value.trim();
  const token = localStorage.getItem('token');

  // Reset messages
  bvnError.style.display = 'none';
  bvnSuccess.style.display = 'none';

  // Validation
  if (!bvn || bvn.length!== 11 ||!/^\d+$/.test(bvn)) {
    bvnError.textContent = 'BVN must be exactly 11 digits';
    bvnError.style.display = 'block';
    return;
  }

  if (!token) {
    bvnError.textContent = 'Session expired. Please login again.';
    bvnError.style.display = 'block';
    return;
  }

  // Show loading
  verifyBtn.textContent = 'Processing...';
  verifyBtn.disabled = true;

  try {
    const response = await fetch(`${API_URL}/api/kyc/verify-bvn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bvn })
    });

    const data = await response.json();

    if (response.ok) {
      bvnSuccess.textContent = data.message;
      bvnSuccess.style.display = 'block';

      // Update localStorage
      const user = JSON.parse(localStorage.getItem('user'));
      user.kycStatus = data.kycStatus;
      user.kycTier = data.kycTier;
      localStorage.setItem('user', JSON.stringify(user));

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);

    } else {
      bvnError.textContent = data.error || 'Verification failed';
      bvnError.style.display = 'block';
    }

  } catch (error) {
    console.error('BVN error:', error);
    bvnError.textContent = 'Network error. Please try again.';
    bvnError.style.display = 'block';
  } finally {
    verifyBtn.textContent = 'Verify BVN';
    verifyBtn.disabled = false;
  }
}

// ===================
// LOGIN FUNCTION - FOR CONTEXT
// ===================
async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');

  try {
    const response = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Check KYC status
      if (data.user.kycStatus === 'unverified' || data.user.kycTier === 0) {
        window.location.href = '/?kyc=required';
      } else {
        window.location.href = '/';
      }
    } else {
      errorMsg.textContent = data.error;
    }
  } catch (error) {
    errorMsg.textContent = 'Network error. Please try again.';
  }
}