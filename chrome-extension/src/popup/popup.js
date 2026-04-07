const API_BASE_URL = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.api_base_url) || 'https://api.driversreward.com';

let pollInterval = null;

async function init() {
  const auth = await sendMessage({ type: 'GET_AUTH' });

  if (auth?.accessToken) {
    document.body.className = 'logged-in';
    document.getElementById('driver-email').textContent = auth.email || '';
    await loadDashboard(auth);
    startPolling();
  } else {
    document.body.className = 'logged-out';
    stopPolling();
  }
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

// --- Dashboard data ---
async function loadDashboard(auth) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/rewards/balance`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });

    if (res.ok) {
      const data = await res.json();
      document.getElementById('points-balance').textContent =
        data.pointsBalance?.toLocaleString() || '0';
      document.getElementById('lifetime-points').textContent =
        data.lifetimePoints?.toLocaleString() || '0';
    }
  } catch {
    document.getElementById('points-balance').textContent = '—';
  }
}

// --- Polling for progress + login state ---
function startPolling() {
  updateAllStatuses();
  pollInterval = setInterval(updateAllStatuses, 1500);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function updateAllStatuses() {
  chrome.storage.local.get(
    ['uberLoginState', 'fetchProgress', 'uberSessionStatus', 'lastSync', 'lastSyncResult', 'rawTripQueue'],
    (result) => {
      updateProgressUI(result.uberLoginState, result.fetchProgress);
      updateUberSessionUI(result.uberSessionStatus);
      updatePendingCount(result.rawTripQueue);
      updateSyncResult(result.fetchProgress, result.lastSyncResult);
    },
  );
}

function updatePendingCount(queue) {
  const count = Array.isArray(queue) ? queue.length : 0;
  document.getElementById('pending-count').textContent = count;
}

// --- Progress step UI ---
function setStepState(stepId, state) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.className = `step-item ${state}`;
  const icon = el.querySelector('.step-icon');
  if (state === 'done') icon.textContent = '✓';
  else if (state === 'active') icon.innerHTML = '<span class="spinner"></span>';
  else if (state === 'error') icon.textContent = '✗';
}

function updateProgressUI(loginState, progress) {
  const uberState = loginState?.state || 'unknown';
  const step = progress?.step || null;
  const detail = document.getElementById('progress-detail');
  const barWrap = document.getElementById('progress-bar-wrap');
  const barFill = document.getElementById('progress-bar-fill');

  // Step 1: Uber login
  if (uberState === 'logged_in' || step) {
    setStepState('step-uber-login', 'done');
  } else if (uberState === 'logged_out') {
    setStepState('step-uber-login', 'active');
    detail.textContent = 'Please open the Uber Driver Portal and log in.';
    barWrap.style.display = 'none';
    // Reset other steps
    setStepState('step-fetch-history', '');
    setStepState('step-fetch-details', '');
    setStepState('step-sync', '');
    return;
  } else if (uberState === 'checking') {
    setStepState('step-uber-login', 'active');
    detail.textContent = 'Verifying your Uber session...';
    barWrap.style.display = 'none';
    return;
  } else {
    // No state yet — waiting for user action
    setStepState('step-uber-login', '');
    detail.textContent = 'Click "Open Uber Driver Portal" to begin.';
    barWrap.style.display = 'none';
    return;
  }

  // Step 2: Fetching history
  if (step === 'starting' || step === 'fetching_history') {
    setStepState('step-fetch-history', 'active');
    setStepState('step-fetch-details', '');
    setStepState('step-sync', '');
    barWrap.style.display = 'block';
    const pct = progress.totalWeeks ? Math.round((progress.week / progress.totalWeeks) * 100) : 10;
    barFill.style.width = `${pct}%`;
    detail.textContent = progress.message || 'Scanning trip history...';
    return;
  }

  if (step === 'fetching_history') {
    setStepState('step-fetch-history', 'active');
  } else if (step === 'fetching_details' || step === 'submitting' || step === 'done' || step === 'error') {
    setStepState('step-fetch-history', 'done');
  }

  // Step 3: Fetching details
  if (step === 'fetching_details') {
    setStepState('step-fetch-details', 'active');
    setStepState('step-sync', '');
    barWrap.style.display = 'block';
    const pct = progress.total ? Math.round((progress.fetched / progress.total) * 100) : 50;
    barFill.style.width = `${pct}%`;
    detail.textContent = progress.message || 'Fetching trip details...';
    return;
  } else if (step === 'submitting' || step === 'done' || step === 'error') {
    setStepState('step-fetch-details', 'done');
  }

  // Step 4: Syncing
  if (step === 'submitting') {
    setStepState('step-sync', 'active');
    barWrap.style.display = 'block';
    barFill.style.width = '90%';
    detail.textContent = progress.message || 'Sending data to server...';
    return;
  } else if (step === 'done') {
    setStepState('step-sync', 'done');
    barWrap.style.display = 'block';
    barFill.style.width = '100%';
    detail.textContent = 'All done! Your points have been updated.';
    // Refresh dashboard points
    getAuth().then((auth) => { if (auth) loadDashboard(auth); });
  } else if (step === 'error') {
    setStepState('step-sync', 'error');
    barWrap.style.display = 'none';
    detail.textContent = progress.message || 'Something went wrong.';
  }
}

async function getAuth() {
  return sendMessage({ type: 'GET_AUTH' });
}

function updateSyncResult(progress, lastResult) {
  const container = document.getElementById('sync-result');
  if (!progress || progress.step !== 'done' || !lastResult) {
    // Check if we have a previous result to show
    if (lastResult && lastResult.created !== undefined) {
      container.style.display = 'block';
      const hasErrors = lastResult.errors > 0;
      container.className = `result-card ${hasErrors ? 'has-errors' : ''}`;
      container.innerHTML = `
        <div style="font-size:13px;font-weight:600;margin-bottom:8px">Last Sync Result</div>
        <div class="result-stat"><strong>${lastResult.created || 0}</strong> New trips</div>
        <div class="result-stat"><strong>${lastResult.duplicates || 0}</strong> Already synced</div>
        <div class="result-stat"><strong>+${lastResult.totalPointsAwarded || 0}</strong> Points earned</div>
        ${hasErrors ? `<div style="font-size:11px;color:#dc2626;margin-top:4px">${lastResult.errors} trips had errors</div>` : ''}
      `;
    } else {
      container.style.display = 'none';
    }
    return;
  }

  container.style.display = 'block';
  const hasErrors = (progress.errors || 0) > 0;
  container.className = `result-card ${hasErrors ? 'has-errors' : ''}`;
  container.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Sync Complete!</div>
    <div class="result-stat"><strong>${progress.created || 0}</strong> New trips</div>
    <div class="result-stat"><strong>${progress.duplicates || 0}</strong> Already synced</div>
    <div class="result-stat"><strong>+${progress.pointsAwarded || 0}</strong> Points earned</div>
    ${hasErrors ? `<div style="font-size:11px;color:#dc2626;margin-top:4px">${progress.errors} trips had errors</div>` : ''}
  `;
}

// --- Uber session status ---
function updateUberSessionUI(status) {
  const dot = document.getElementById('uber-session-dot');
  const text = document.getElementById('uber-session-text');

  if (!status) {
    dot.className = 'sync-dot checking';
    text.textContent = 'Uber session: checking...';
    return;
  }

  if (!status.active) {
    dot.className = 'sync-dot error';
    text.textContent = 'Uber session: EXPIRED — please log in again';
    return;
  }

  if (status.minutesUntilExpiry !== null && status.minutesUntilExpiry < 30) {
    dot.className = 'sync-dot pending';
    text.textContent = `Uber session: expiring in ${status.minutesUntilExpiry}min`;
  } else if (status.minutesUntilExpiry !== null) {
    const hours = Math.floor(status.minutesUntilExpiry / 60);
    dot.className = 'sync-dot';
    text.textContent = `Uber session: active (${hours}h remaining)`;
  } else if (status.cookieCount) {
    dot.className = 'sync-dot';
    text.textContent = `Uber session: active (${status.cookieCount} cookies)`;
  } else {
    dot.className = 'sync-dot';
    text.textContent = 'Uber session: active';
  }
}

// --- Auth ---
function showError(msg) {
  const el = document.getElementById('error-message');
  el.textContent = msg;
  el.style.display = 'block';
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) { showError('Please fill in all fields'); return; }

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Login failed'); return; }

    await sendMessage({
      type: 'SET_AUTH',
      auth: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        driverId: data.driver.id,
        region: data.driver.region,
        email: data.driver.email,
      },
    });

    init();
  } catch { showError('Network error. Please try again.'); }
});

function showSuccess(msg) {
  const el = document.getElementById('success-message');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function hideAllAuthForms() {
  document.getElementById('error-message').style.display = 'none';
  document.getElementById('login-form-wrap').style.display = 'none';
  document.getElementById('forgot-form-wrap').style.display = 'none';
  document.getElementById('reset-form-wrap').style.display = 'none';
  document.getElementById('register-form-wrap').style.display = 'none';
  document.getElementById('btn-show-register').style.display = 'none';
}

function showLoginForm() {
  hideAllAuthForms();
  document.getElementById('login-form-wrap').style.display = '';
  document.getElementById('btn-show-register').style.display = '';
}

// Forgot password flow
let resetEmail = '';

document.getElementById('btn-show-forgot')?.addEventListener('click', (e) => {
  e.preventDefault();
  hideAllAuthForms();
  document.getElementById('forgot-form-wrap').style.display = '';
  const loginEmail = document.getElementById('login-email').value.trim();
  if (loginEmail) document.getElementById('forgot-email').value = loginEmail;
});

document.getElementById('btn-forgot-back')?.addEventListener('click', () => showLoginForm());
document.getElementById('btn-reset-back')?.addEventListener('click', () => showLoginForm());

document.getElementById('btn-send-code')?.addEventListener('click', async () => {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) { showError('Please enter your email'); return; }

  const btn = document.getElementById('btn-send-code');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Failed to send code'); return; }

    resetEmail = email;
    hideAllAuthForms();
    document.getElementById('reset-form-wrap').style.display = '';
    showSuccess('Reset code sent! Check your email.');
  } catch { showError('Network error. Please try again.'); }
  finally {
    btn.disabled = false;
    btn.textContent = 'Send Reset Code';
  }
});

document.getElementById('btn-reset-password')?.addEventListener('click', async () => {
  const code = document.getElementById('reset-code').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;
  const confirmPassword = document.getElementById('reset-confirm-password').value;

  if (!code || code.length !== 6) { showError('Please enter the 6-digit code'); return; }
  if (!newPassword || newPassword.length < 8) { showError('Password must be at least 8 characters'); return; }
  if (newPassword !== confirmPassword) { showError('Passwords do not match'); return; }

  const btn = document.getElementById('btn-reset-password');
  btn.disabled = true;
  btn.textContent = 'Resetting...';

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: resetEmail, code, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Reset failed'); return; }

    showLoginForm();
    showSuccess('Password reset! Please sign in with your new password.');
    document.getElementById('login-email').value = resetEmail;
    document.getElementById('login-password').value = '';
    resetEmail = '';
  } catch { showError('Network error. Please try again.'); }
  finally {
    btn.disabled = false;
    btn.textContent = 'Reset Password';
  }
});

document.getElementById('btn-show-register').addEventListener('click', () => {
  hideAllAuthForms();
  document.getElementById('register-form-wrap').style.display = '';
});

document.getElementById('btn-register-back')?.addEventListener('click', () => showLoginForm());

document.getElementById('btn-register').addEventListener('click', async () => {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const region = document.getElementById('reg-region').value;
  const referralCode = document.getElementById('reg-referral').value.trim() || undefined;

  if (!name || !email || !password) { showError('Please fill in all required fields'); return; }
  if (password.length < 8) { showError('Password must be at least 8 characters'); return; }

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, region, referralCode, consentDataCollection: true }),
    });

    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Registration failed'); return; }

    await sendMessage({
      type: 'SET_AUTH',
      auth: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        driverId: data.driver.id,
        region: data.driver.region,
        email: data.driver.email,
      },
    });

    init();
  } catch { showError('Network error. Please try again.'); }
});

document.getElementById('btn-open-uber')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://drivers.uber.com/' });
});

document.getElementById('btn-rewards')?.addEventListener('click', async () => {
  document.getElementById('main-actions').style.display = 'none';
  document.getElementById('progress-section').style.display = 'none';
  document.getElementById('sync-result').style.display = 'none';
  document.getElementById('uber-session-bar').style.display = 'none';
  document.getElementById('rewards-section').style.display = 'block';
  await loadRewardsUI();
});

document.getElementById('btn-back-main')?.addEventListener('click', () => {
  document.getElementById('rewards-section').style.display = 'none';
  document.getElementById('main-actions').style.display = '';
  document.getElementById('progress-section').style.display = '';
  document.getElementById('uber-session-bar').style.display = '';
});

async function loadRewardsUI() {
  const auth = await getAuth();
  if (!auth?.accessToken) return;
  const hdr = { Authorization: `Bearer ${auth.accessToken}` };

  const gcList = document.getElementById('gift-cards-list');
  gcList.innerHTML = '<div style="text-align:center;padding:12px;color:#888;font-size:12px">Loading...</div>';

  try {
    const [gcRes, rdRes, balRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/rewards/gift-cards`, { headers: hdr }).then(r => r.json()),
      fetch(`${API_BASE_URL}/api/rewards/redemptions?limit=10`, { headers: hdr }).then(r => r.json()),
      fetch(`${API_BASE_URL}/api/rewards/balance`, { headers: hdr }).then(r => r.json()),
    ]);

    const balance = balRes.pointsBalance || 0;

    if (!gcRes.giftCards?.length) {
      gcList.innerHTML = '<div style="text-align:center;padding:12px;color:#888;font-size:12px">No gift cards available yet. Check back soon!</div>';
    } else {
      gcList.innerHTML = '';
      for (const gc of gcRes.giftCards) {
        const item = document.createElement('div');
        item.className = 'gc-item';
        const canAfford = balance >= gc.pointsCost;
        item.innerHTML = `
          <div>
            <div class="gc-name">${gc.name}</div>
            <div class="gc-detail">${gc.provider} — ${gc.currency} ${gc.faceValue}</div>
          </div>
          <div style="text-align:right">
            <div class="gc-cost">${gc.pointsCost} pts</div>
            <button class="gc-btn" data-id="${gc.id}" data-name="${gc.name}" data-cost="${gc.pointsCost}" ${canAfford ? '' : 'disabled'}>${canAfford ? 'Redeem' : 'Need more pts'}</button>
          </div>
        `;
        gcList.appendChild(item);
      }

      gcList.querySelectorAll('.gc-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Redeem ${btn.dataset.name} for ${btn.dataset.cost} points?\n\nYour request will be reviewed by our team and a gift card code will be sent to you.`)) return;
          btn.disabled = true;
          btn.textContent = 'Processing...';
          try {
            const res = await fetch(`${API_BASE_URL}/api/rewards/redeem`, {
              method: 'POST',
              headers: { ...hdr, 'Content-Type': 'application/json' },
              body: JSON.stringify({ giftCardId: btn.dataset.id }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Redemption failed');
            alert(`Request submitted! Your ${result.giftCardName} redemption is now being reviewed. We'll send you the gift card code shortly.`);
            loadRewardsUI();
            loadDashboard(auth);
          } catch (err) {
            alert('Redemption failed: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Redeem';
          }
        });
      });
    }

    // Redemption history
    const rdContainer = document.getElementById('my-redemptions');
    const rdList = document.getElementById('redemptions-list');
    if (rdRes.redemptions?.length > 0) {
      rdContainer.style.display = '';
      rdList.innerHTML = '';
      const statusCls = { PENDING: 'rd-pending', PROCESSING: 'rd-processing', FULFILLED: 'rd-fulfilled', FAILED: 'rd-failed', CANCELLED: 'rd-cancelled' };
      const statusLabels = {
        PENDING: 'Request Sent',
        PROCESSING: 'Under Review',
        FULFILLED: 'Gift Code Sent',
        FAILED: 'Failed',
        CANCELLED: 'Cancelled',
      };
      for (const rd of rdRes.redemptions) {
        const item = document.createElement('div');
        item.className = 'rd-item';
        let html = `
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:500">${rd.giftCard?.name || 'Gift Card'}</span>
            <span class="rd-status ${statusCls[rd.status] || ''}">${statusLabels[rd.status] || rd.status}</span>
          </div>
          <div style="color:#888;font-size:11px;margin-top:2px">${new Date(rd.createdAt).toLocaleDateString()} — ${rd.pointsSpent} pts</div>
        `;
        if (rd.status === 'FULFILLED' && rd.giftCardCode) {
          html += `<div class="gc-code">${rd.giftCardCode}</div>`;
        }
        if (rd.status === 'PENDING') {
          html += `<div style="font-size:10px;color:#92400e;margin-top:3px">Our team will review and send you a gift card code soon.</div>`;
        }
        if (rd.status === 'CANCELLED' && rd.failureReason) {
          html += `<div style="font-size:10px;color:#991b1b;margin-top:3px">${rd.failureReason}</div>`;
        }
        item.innerHTML = html;
        rdList.appendChild(item);
      }
    } else {
      rdContainer.style.display = 'none';
    }
  } catch {
    gcList.innerHTML = '<div style="text-align:center;padding:12px;color:#F44336;font-size:12px">Failed to load rewards. Please try again.</div>';
  }
}

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  stopPolling();
  await sendMessage({ type: 'LOGOUT' });
  init();
});

init();
