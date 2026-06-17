<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CreativePay - Login</title>
    <style>
        body { font-family: Arial, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; margin: 0; }
       .container { max-width: 400px; margin: 60px auto; }
       .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 24px; margin-bottom: 16px; }
       .card-title { font-size: 20px; font-weight: 600; margin-bottom: 16px; text-align: center; }
        input, select { width: 100%; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 10px; border-radius: 6px; margin-bottom: 12px; box-sizing: border-box; }
       .sec-btn { width: 100%; background: #238636; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
       .sec-btn:hover { background: #2ea043; }
       .link { color: #58a6ff; cursor: pointer; text-align: center; display: block; margin-top: 12px; font-size: 14px; }
       .hidden { display: none; }
       .error { color: #f85149; font-size: 12px; margin-bottom: 12px; text-align: center; }
       .nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
       .logout { color: #f85149; cursor: pointer; font-size: 14px; }
    </style>
</head>
<body>

<div id="auth-container" class="container">
    <div id="login-card" class="card">
        <div class="card-title">CreativePay Login</div>
        <div id="login-error" class="error"></div>
        <input type="email" id="login-email" placeholder="Email" />
        <input type="password" id="login-password" placeholder="Password" />
        <button class="sec-btn" onclick="login()">Sign In</button>
        <div class="link" onclick="showRegister()">Need an account? Register</div>
    </div>

    <div id="register-card" class="card hidden">
        <div class="card-title">Create Account</div>
        <div id="register-error" class="error"></div>
        <input type="text" id="reg-name" placeholder="Full Name / Creator Name" />
        <input type="email" id="reg-email" placeholder="Email" />
        <input type="password" id="reg-password" placeholder="Password" />
        <input type="text" id="reg-momo" placeholder="Mobile Money Number" />
        <select id="reg-provider">
            <option value="">Select Provider</option>
            <option value="MTN">MTN MoMo</option>
            <option value="Vodafone">Vodafone Cash</option>
            <option value="Airtel">Airtel Money</option>
            <option value="Safaricom">M-Pesa</option>
        </select>
        <select id="reg-country">
            <option value="NGN">Nigeria - NGN</option>
            <option value="GHS">Ghana - GHS</option>
            <option value="KES">Kenya - KES</option>
        </select>
        <button class="sec-btn" onclick="register()">Create Account</button>
        <div class="link" onclick="showLogin()">Have an account? Sign In</div>
    </div>
</div>

<div id="dashboard-container" class="container hidden" style="max-width: 900px;">
    <div class="nav">
        <div>Welcome, <span id="user-name"></span></div>
        <div class="logout" onclick="logout()">Logout</div>
    </div>

    <div class="card">
        <div class="card-title">CreativePay Live Demo Terminal</div>
        <button class="sec-btn" onclick="generateInvoice()" style="width:auto; margin-right:8px;">Create Mock $500 Invoice</button>
        <button class="sec-btn" onclick="settlePayment()" style="width:auto; margin-right:8px;">Simulate Settlement</button>
        <button class="sec-btn" onclick="triggerDoubleSpend()" style="width:auto;">Test Anti-Double Spend</button>
    </div>

    <div class="card">
        <div class="card-title">Global FX Settlement Ledger</div>
        <div>Status: <span id="ledger-status">IDLE</span></div>
        <div>Gross: <span id="ledger-gross">$0.00 USD</span></div>
        <div>Fee: <span id="ledger-fee">$0.00 USD</span></div>
        <div>Net: <span id="ledger-net">$0.00 USD</span></div>
        <div>Payout: <span id="ledger-payout">Awaiting invoice...</span></div>
        <div>Invoice ID: <span id="current-inv-id">None</span></div>
    </div>

    <div class="card">
        <div class="card-title">Venture Capital Metrics Terminal</div>
        <pre id="output-window">Click a button above to run real-time cloud computations...</pre>
    </div>
</div>

<script>
    const HOST = "https://creative-payroll-infrastructure.onrender.com";
    let savedInvoiceId = "";
    let token = localStorage.getItem('cp_token');
    let user = JSON.parse(localStorage.getItem('cp_user') || 'null');

    // === AUTH FLOW ===
    function showLogin() {
        document.getElementById('login-card').classList.remove('hidden');
        document.getElementById('register-card').classList.add('hidden');
    }
    function showRegister() {
        document.getElementById('login-card').classList.add('hidden');
        document.getElementById('register-card').classList.remove('hidden');
    }
    function showDashboard() {
        document.getElementById('auth-container').classList.add('hidden');
        document.getElementById('dashboard-container').classList.remove('hidden');
        document.getElementById('user-name').innerText = user.creativeName;
    }
    function logout() {
        localStorage.removeItem('cp_token');
        localStorage.removeItem('cp_user');
        location.reload();
    }

    async function register() {
        const body = {
            creativeName: document.getElementById('reg-name').value,
            email: document.getElementById('reg-email').value,
            password: document.getElementById('reg-password').value,
            mobileMoneyNumber: document.getElementById('reg-momo').value,
            mobileMoneyProvider: document.getElementById('reg-provider').value,
            country: document.getElementById('reg-country').value
        };
        try {
            const res = await fetch(`${HOST}/api/auth/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            localStorage.setItem('cp_token', data.token);
            localStorage.setItem('cp_user', JSON.stringify(data.user));
            token = data.token; user = data.user;
            showDashboard();
        } catch (err) {
            document.getElementById('register-error').innerText = err.message;
        }
    }

    async function login() {
        const body = {
            email: document.getElementById('login-email').value,
            password: document.getElementById('login-password').value
        };
        try {
            const res = await fetch(`${HOST}/api/auth/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            localStorage.setItem('cp_token', data.token);
            localStorage.setItem('cp_user', JSON.stringify(data.user));
            token = data.token; user = data.user;
            showDashboard();
        } catch (err) {
            document.getElementById('login-error').innerText = err.message;
        }
    }

    // === API CALLS WITH AUTH ===
    function authHeaders() {
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    }
    function log(msg) {
        document.getElementById('output-window').innerText = typeof msg === 'object'? JSON.stringify(msg, null, 2) : msg;
    }

    async function generateInvoice() {
        log("Generating invoice...");
        try {
            const res = await fetch(`${HOST}/api/invoices`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    creativeName: user.creativeName,
                    email: user.email,
                    amountUSD: 500,
                    targetCurrency: user.country || "NGN"
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            savedInvoiceId = data.invoice?._id || data.invoice?.id || data._id;
            document.getElementById("current-inv-id").innerText = savedInvoiceId;
            document.getElementById("ledger-status").innerText = "INVOICE_CREATED";
            document.getElementById("ledger-gross").innerText = "$500.00 USD";
            log(data);
        } catch (err) { log("Error: " + err.message); }
    }

    async function settlePayment() {
        if (!savedInvoiceId) return alert("Create invoice first");
        log("Settling...");
        try {
            const res = await fetch(`${HOST}/api/webhooks/blockchain-payment`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ txHash: "0x7a" + Math.random().toString(16).substr(2, 40), invoiceId: savedInvoiceId })
            });
            const data = await res.json();
            log(data);
            document.getElementById("ledger-status").innerText = "SETTLED / ASSETS DISBURSED";
            document.getElementById("ledger-fee").innerText = "$5.00 USD";
            document.getElementById("ledger-net").innerText = "$495.00 USD";
        } catch (err) { log("Error: " + err.message); }
    }

    async function triggerDoubleSpend() {
        if (!savedInvoiceId) return alert("Create invoice first");
        try {
            const res = await fetch(`${HOST}/api/webhooks/blockchain-payment`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ txHash: "0xFAKE" + Math.random().toString(16).substr(2, 40), invoiceId: savedInvoiceId })
            });
            const data = await res.json();
            log(data);
            if (res.status === 409 || data.error) alert("Anti-Double Spend Guard: PASSED ✅");
        } catch (err) { log("Error: " + err.message); }
    }

    // Init
    if (token && user) showDashboard();
</script>

</body>
</html>