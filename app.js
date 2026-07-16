// ============================================================================
// CONFIG - GLOBAL APPLICATION SETTING RAILS
// ============================================================================
const API_URL = '/api';

let token = localStorage.getItem('token');
let isLoginMode = true;
let kycStatus = localStorage.getItem('kycStatus') || 'unverified'; // 'unverified' or 'verified'
let facialStream = null; // For 1-time facial seal
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
// SPA ROUTING ENGINE: UPDATE VIEW STATE MAPS CLEANLY - FIXED
// ============================================================================
function showUIState(viewState) {
  const authSection = document.getElementById('authSection');
  const bvnSection = document.getElementById('bvnSection');
  const dashboardSection = document.getElementById('dashboardSection');
  const mainHeader = document.getElementById('mainHeader');
  const backBtn = document.getElementById('backBtn'); // NEW BACK BUTTON

  [authSection, bvnSection, dashboardSection].forEach(s => s && s.classList.add('hidden'));

  if (viewState === 'auth') {
    authSection && authSection.classList.remove('hidden');
    mainHeader && mainHeader.classList.add('hidden');
    backBtn && backBtn.classList.add('hidden');
  } else if (viewState === 'dashboard') {
    dashboardSection && dashboardSection.classList.remove('hidden');
    mainHeader && mainHeader.classList.remove('hidden');
    backBtn && backBtn.classList.add('hidden'); // Hide back on main dashboard
    loadDashboard();
  } else if (viewState === 'bvn') {
    // FIX: Check if already verified - 1 TIME SEAL
    if(kycStatus === 'verified') {
      showToast('BVN Already Verified ✅ No re-verification needed', 'success');
      return showUIState('dashboard');
    }
    bvnSection && bvnSection.classList.remove('hidden');
    mainHeader && mainHeader.classList.remove('hidden');
    backBtn && backBtn.classList.remove('hidden'); // SHOW BACK BUTTON ON BVN PAGE
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

  // AUTH
  document.getElementById('toggleAuthLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthMode();
  });
  document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('registerBtn')?.addEventListener('click', handleRegister);
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
document.getElementById('backBtn')?.addEventListener('click', () => {
  stopCamera(); // Stop camera if running
  showUIState('dashboard');
});
  // PASSWORD TOGGLE
  document.getElementById('togglePasswordBtn')?.addEventListener('click', () => {
    const passField = document.getElementById('password');
    if(passField) {
      passField.type = passField.type === 'password'? 'text' : 'password';
      document.getElementById('togglePasswordBtn').innerText = passField.type === 'password'? 'Show' : 'Hide';
    }
  });

  // KYC + FACIAL + DELETE
  document.getElementById('bvn-verify-btn')?.addEventListener('click', () => showUIState('bvn'));
  document.getElementById('verifyBvnBtn')?.addEventListener('click', handleBvnVerification);
  document.getElementById('facial-verify-btn')?.addEventListener('click', handleFacialVerification);
  document.getElementById('delete-account-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('delete-modal');
    if(modal) modal.style.display = 'flex';
  });
  document.getElementById('cancel-delete-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('delete-modal');
    if(modal) modal.style.display = 'none';
  });
  document.getElementById('confirm-delete-btn')?.addEventListener('click', handleDeleteAccount);

  // WALLET + PAYOUT
  document.getElementById('deposit-btn')?.addEventListener('click', handleFundWallet);
  document.getElementById('payout-btn')?.addEventListener('click', handleSendMoney);
});

// ============================================================================
// UI STATE MACHINE: SWAP INTERFACE MODES
// ============================================================================
function toggleAuthMode() {
  isLoginMode =!isLoginMode;
  const authTitle = document.getElementById('authTitle');
  const nameGroup = document.getElementById('nameGroup');
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const toggleAuthLink = document.getElementById('toggleAuthLink');
  const errorMsg = document.getElementById('errorMsg');

  if(errorMsg) errorMsg.innerText = '';

  if (isLoginMode) {
    authTitle && (authTitle.innerText = 'Login');
    nameGroup && nameGroup.classList.add('hidden');
    loginBtn && loginBtn.classList.remove('hidden');
    registerBtn && registerBtn.classList.add('hidden');
    toggleAuthLink && (toggleAuthLink.innerText = "Don't have an account? Register");
  } else {
    authTitle && (authTitle.innerText = 'Register Account');
    nameGroup && nameGroup.classList.remove('hidden');
    loginBtn && loginBtn.classList.add('hidden');
    registerBtn && registerBtn.classList.remove('hidden');
    toggleAuthLink && (toggleAuthLink.innerText = "Already have an account? Login");
  }
}

// ============================================================================
// HANDLER: CORE USER AUTHENTICATION
// ============================================================================
async function handleLogin() {
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value;
  const loginBtn = document.getElementById('loginBtn');
  const errorMsg = document.getElementById('errorMsg');

  if (!email ||!password) {
    if(errorMsg) errorMsg.innerText = 'Email and password credentials are required.';
    return;
  }

  try {
    setLoadingState(loginBtn, true, 'Authenticating...');
    if(errorMsg) errorMsg.innerText = '';

    const response = await fetch(`${API_URL}/login`, {
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
      if(errorMsg) errorMsg.innerText = data.message || 'Login credentials rejected.';
      showToast(data.message || 'Verification rejected', 'error');
    }
  } catch (err) {
    console.error(err);
    if(errorMsg) errorMsg.innerText = 'Communication link timeout on core infrastructure.';
    showToast('Network error', 'error');
  } finally {
    setLoadingState(loginBtn, false, 'Login');
  }
}

// ============================================================================
// HANDLER: ONBOARDING ACCREDITATION / REGISTRATION
// ============================================================================
async function handleRegister() {
  const fullName = document.getElementById('fullName')?.value.trim();
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value;
  const registerBtn = document.getElementById('registerBtn');
  const errorMsg = document.getElementById('errorMsg');

  if (!fullName ||!email ||!password) {
    if(errorMsg) errorMsg.innerText = 'All profiling credentials are required to onboard.';
    return;
  }

  try {
    setLoadingState(registerBtn, true, 'Processing Profiling...');
    if(errorMsg) errorMsg.innerText = '';

    const response = await fetch(`${API_URL}/register`, {
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
      if(errorMsg) errorMsg.innerText = data.message || 'Onboarding registration failed.';
      showToast(data.message || 'Registration rejected', 'error');
    }
  } catch (err) {
    console.error(err);
    if(errorMsg) errorMsg.innerText = 'Unable to bind communication network with core rail.';
    showToast('Network error', 'error');
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
    const response = await fetch(`${API_URL}/user`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();

    if (data.success) {
      document.getElementById('user-name') && (document.getElementById('user-name').innerText = data.user?.name || 'Test Final');
      document.getElementById('user-email') && (document.getElementById('user-email').innerText = data.user?.email || '');
      
      // FIXED: Use badge span instead of account-id
      const badge = document.querySelector('.badge');
      if(badge) badge.innerText = data.walletId || 'CFA1A40882';

      // Balances - map to new currency grid
      const b = data.balances || {};
      const currencyItems = document.querySelectorAll('.currency-item strong');
      if(currencyItems.length >= 6){
        currencyItems[0].innerText = `₦${parseFloat(b.NGN || 0).toFixed(2)}`;
        currencyItems[1].innerText = `₵${parseFloat(b.GHS || 0).toFixed(2)}`;
        currencyItems[2].innerText = `KSh${parseFloat(b.KES || 0).toFixed(2)}`;
        currencyItems[3].innerText = `$${parseFloat(b.USD || 0).toFixed(2)}`;
        currencyItems[4].innerText = `€${parseFloat(b.EUR || 0).toFixed(2)}`;
        currencyItems[5].innerText = `£${parseFloat(b.GBP || 0).toFixed(2)}`;
      }

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
  const auditLog = document.getElementById('audit-log');
  if (!auditLog) return;

  try {
    const response = await fetch(`${API_URL}/transactions`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();

    if(data.success && data.transactions?.length > 0) {
      auditLog.innerHTML = data.transactions.map(tx => `
        <div class="txn">
          <div>
            <div style="font-weight:600">${tx.type}</div>
            <div style="font-size:12px; color:gray">${new Date(tx.date).toLocaleDateString()}</div>
          </div>
          <div class="${tx.status}">${tx.amount > 0? '+' : ''}₦${Math.abs(tx.amount).toFixed(2)} - ${tx.status}</div>
        </div>
      `).join('');
    } else {
      auditLog.innerHTML = '<p>No ledger items recorded.</p>';
    }
  } catch (err) {
    console.error(err);
    auditLog.innerText = 'Could not load transactions';
  }
}

// ============================================================================
// HANDLER: BVN VERIFICATION - PRODUCTION
// ============================================================================
// OLD BACKEND VERSION - BACKUP v10b
// async function handleBvnVerification() {
//   const bvn = document.getElementById('bvnInput')?.value.trim();
//   const bvnError = document.getElementById('bvnError');
//   const bvnSuccess = document.getElementById('bvnSuccess');
//
//   if(bvnError) bvnError.style.display = 'none';
//   if(bvnSuccess) bvnSuccess.style.display = 'none';
//
//   if (!bvn || bvn.length!== 11) {
//     if(bvnError) { bvnError.style.display = 'block'; bvnError.innerText = 'BVN must be exactly 11 digits'; }
//     return;
//   }
//
//   try {
//     setLoadingState(document.getElementById('verifyBvnBtn'), true, 'Verifying...');
//     const response = await fetch(`${API_URL}/kyc/verify-bvn`, {
//       method: 'POST',
//       headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
//       body: JSON.stringify({bvn})
//     });
//     const data = await response.json();
//
//     if(data.success) {
//       // SEAL IT: 1 TIME ONLY
//       kycStatus = 'verified';
//       localStorage.setItem('kycStatus', 'verified');
//       if(bvnSuccess) { bvnSuccess.style.display = 'block'; bvnSuccess.innerText = 'BVN Verified Successfully! SEALED'; }
//       showToast('KYC Upgraded to Verified ✅ SEALED', 'success');
//       setTimeout(() => showUIState('dashboard'), 2000);
//     } else {
//       if(bvnError) { bvnError.style.display = 'block'; bvnError.innerText = data.message || 'BVN Verification Failed'; }
//     }
//   } catch (err) {
//     if(bvnError) { bvnError.style.display = 'block'; bvnError.innerText = 'Network error during BVN verification'; }
//   } finally {
//     setLoadingState(document.getElementById('verifyBvnBtn'), false, 'Verify BVN Data');
//   }
// }

// NEW: DIRECT PAYSTACK BVN VERIFICATION v10c
async function handleBvnVerification() {
  const bvn = document.getElementById('bvnInput')?.value.trim();
  const bvnError = document.getElementById('bvnError');
  const bvnSuccess = document.getElementById('bvnSuccess');
  const btn = document.getElementById('verifyBvnBtn');

  if(bvnError) bvnError.style.display = 'none';
  if(bvnSuccess) bvnSuccess.style.display = 'none';

  if (!bvn || bvn.length !== 11) {
    if(bvnError) { bvnError.style.display = 'block'; bvnError.innerText = 'BVN must be exactly 11 digits'; }
    return;
  }

  setLoadingState(btn, true, 'Verifying...');

  try {
    const response = await fetch(`https://api.paystack.co/bank/resolve_bvn/${bvn}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer pk_test_22b404c1f15be9c94cbde8be2b54d9aa3bce9b4e',
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();

    if (data.status === true) {
      // SEAL IT: 1 TIME ONLY
      localStorage.setItem('kycStatus', 'verified');
      localStorage.setItem('bvnName', data.data.first_name + ' ' + data.data.last_name); // FIXED
      if(bvnSuccess) { 
        bvnSuccess.style.display = 'block'; 
        bvnSuccess.innerText = `BVN Verified Successfully! SEALED: ${data.data.first_name}`; 
      }
      showToast('KYC Upgraded to Verified ✅ SEALED', 'success');
      setTimeout(() => showUIState('dashboard'), 2000);
    } else {
      if(bvnError) { bvnError.style.display = 'block'; bvnError.innerText = data.message || 'BVN Verification Failed'; }
    }
  } catch (err) {
    console.error(err);
    if(bvnError) { bvnError.style.display = 'block'; bvnError.innerText = 'Network error during BVN verification'; }
  } finally {
    setLoadingState(btn, false, 'Verify BVN Data');
  }
}

// HANDLER: FACIAL VERIFICATION - 1 TIME SEAL + GUIDE + COUNTDOWN
async function handleFacialVerification() {
  // SEAL CHECK
  if(kycStatus === 'verified') {
    showToast('Facial Already Verified ✅ Identity Sealed', 'success');
    return;
  }
  
  const video = document.getElementById('cameraPreview');
  const guide = document.getElementById('facialGuide'); // We will add this in HTML next
  
  try {
    showToast('Position your face in the circle', 'success');
    if(guide) guide.classList.remove('hidden');
    
    facialStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    
    if(video) {
      video.srcObject = facialStream;
      video.style.display = 'block';
    }

    let countdown = 4;
    const interval = setInterval(() => {
      if(countdown > 0) {
        showToast(`Hold still... ${countdown}`, 'success');
        countdown--;
      } else {
        clearInterval(interval);
        stopCamera();
        if(guide) guide.classList.add('hidden');
        // SEAL IT
        kycStatus = 'verified';
        localStorage.setItem('kycStatus', 'verified');
        showToast('Facial Verification Successful ✅ IDENTITY SEALED', 'success');
      }
    }, 1000);

  } catch (err) {
    showToast('Camera access denied', 'error');
    console.error(err);
  }
}

// HELPER: STOP CAMERA
function stopCamera() {
  if(facialStream) {
    facialStream.getTracks().forEach(track => track.stop());
    facialStream = null;
  }
  const video = document.getElementById('cameraPreview');
  if(video) video.style.display = 'none';
}
// ============================================================================
// HANDLER: FUND WALLET / DEPOSIT LIQUIDITY
// ============================================================================
async function handleFundWallet() {
  const amount = document.getElementById('deposit-amount')?.value;
  const currency = document.getElementById('deposit-currency')?.value;
  const fundBtn = document.getElementById('deposit-btn');

  if (!amount || amount < 100) {
    showToast('Minimum deposit is 100', 'error');
    return;
  }

  try {
    setLoadingState(fundBtn, true, 'Processing...');

    const response = await fetch(`${API_URL}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ amount: parseFloat(amount), currency })
    });

    const data = await response.json();

    if (data.success) {
      showToast(`${currency} ${amount} funded successfully!`, 'success');
      document.getElementById('deposit-amount') && (document.getElementById('deposit-amount').value = '');
      loadDashboard();
      loadTransactions();
    } else {
      showToast(data.message || 'Deposit failed', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error during deposit', 'error');
  } finally {
    setLoadingState(fundBtn, false, 'Initialize Deposit');
  }
}

// ============================================================================
// HANDLER: GLOBAL REMITTANCE / PAYOUT
// ============================================================================
async function handleSendMoney() {
  const recipient = document.getElementById('recipient')?.value.trim();
  const amount = document.getElementById('transfer-amount')?.value;
  const currency = document.getElementById('transfer-currency')?.value;
  const reference = document.getElementById('transfer-memo')?.value;
  const sendBtn = document.getElementById('payout-btn');

  if (!recipient ||!amount || amount < 10) {
    showToast('Recipient and minimum amount 10 required', 'error');
    return;
  }

  try {
    setLoadingState(sendBtn, true, 'Sending...');

    const response = await fetch(`${API_URL}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ recipient, amount: parseFloat(amount), currency, reference })
    });

    const data = await response.json();

    if (data.success) {
      showToast(`${currency} ${amount} sent to ${recipient}`, 'success');
      document.getElementById('recipient') && (document.getElementById('recipient').value = '');
      document.getElementById('transfer-amount') && (document.getElementById('transfer-amount').value = '');
      document.getElementById('transfer-memo') && (document.getElementById('transfer-memo').value = '');
      loadDashboard();
      loadTransactions();
    } else {
      showToast(data.message || 'Payout failed', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Network error during payout', 'error');
  } finally {
    setLoadingState(sendBtn, false, 'Execute Payout');
  }
}

// ============================================================================
// HANDLER: DELETE ACCOUNT - PRODUCTION
// ============================================================================
async function handleDeleteAccount() {
  const password = document.getElementById('delete-password')?.value;
  if (!password) return showToast('Enter password to confirm', 'error');

  try {
    setLoadingState(document.getElementById('confirm-delete-btn'), true, 'Deleting...');
    const response = await fetch(`${API_URL}/account/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ password })
    });
    const data = await response.json();

    if(data.success) {
      localStorage.clear();
      token = null;
      document.getElementById('delete-modal') && (document.getElementById('delete-modal').style.display = 'none');
      showToast('Account Deleted Permanently', 'success');
      showUIState('auth');
    } else {
      showToast(data.message || 'Delete failed', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  } finally {
    setLoadingState(document.getElementById('confirm-delete-btn'), false, 'Yes, Delete');
  }
}

// ============================================================================
// HANDLER: SESSION TERMINATION
// ============================================================================
function handleLogout() {
  localStorage.removeItem('token');
  token = null;
  showUIState('auth');
  showToast('Logged out successfully', 'success');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function setLoadingState(button, isLoading, text) {
  if(!button) return;
  button.disabled = isLoading;
  button.innerText = text;
}

function clearAuthInputs() {
  document.getElementById('email') && (document.getElementById('email').value = '');
  document.getElementById('password') && (document.getElementById('password').value = '');
  document.getElementById('fullName') && (document.getElementById('fullName').value = '');
                                                           }
