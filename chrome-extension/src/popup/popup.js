const API_BASE_URL = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.api_base_url) || 'https://api.driversreward.com';

let pollInterval = null;
let countdownInterval = null;
let cachedSyncWindow = null;

async function init() {
  const auth = await sendMessage({ type: 'GET_AUTH' });

  if (auth?.accessToken) {
    document.body.className = 'logged-in';
    document.getElementById('driver-email').textContent = auth.phone || auth.email || '';
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
      document.getElementById('month-points').textContent =
        data.monthToDate?.toLocaleString() || '0';

      if (data.syncWindow) {
        cachedSyncWindow = data.syncWindow;
        updateSyncWindowBanner();
        startCountdown();
      }

      renderMonthlyBreakdown(data.monthlyBreakdown || []);
    }
  } catch {
    document.getElementById('points-balance').textContent = '\u2014';
  }
}

// --- Sync Window Banner + Countdown ---
function formatWindowDate(isoDate) {
  const d = new Date(isoDate);
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
}

function formatRelativeTime(ms) {
  if (ms <= 0) return 'soon';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return `in ${parts.join(' ')}`;
}

function updateSyncWindowBanner() {
  const sw = cachedSyncWindow;
  if (!sw) return;

  const banner = document.getElementById('sync-window-banner');
  const iconBox = document.getElementById('sw-icon-box');
  const title = document.getElementById('sw-title');
  const subtitle = document.getElementById('sw-subtitle');
  banner.style.display = 'flex';

  if (sw.inWindow) {
    banner.className = 'sync-window-banner open';
    iconBox.textContent = '\uD83C\uDF1F';
    title.textContent = 'Earn Points Now';
    subtitle.textContent = `Until ${formatWindowDate(sw.windowEnd)}`;
  } else {
    banner.className = 'sync-window-banner closed';
    iconBox.textContent = '\uD83D\uDCC5';
    title.textContent = 'Next Earning Window';
    const nextStart = formatWindowDate(sw.nextWindowStart);
    const nextEnd = formatWindowDate(sw.nextWindowEnd);
    const relTime = formatRelativeTime(new Date(sw.nextWindowStart) - Date.now());
    subtitle.textContent = `${nextStart} \u2013 ${nextEnd} \u00B7 Come back ${relTime}`;
  }
}

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    if (!cachedSyncWindow) return;
    const sw = cachedSyncWindow;
    const now = Date.now();

    if (sw.inWindow) {
      const diff = new Date(sw.windowEnd) - now;
      if (diff <= 0) {
        cachedSyncWindow.inWindow = false;
        updateSyncWindowBanner();
        getAuth().then(auth => { if (auth) loadDashboard(auth); });
        return;
      }
      document.getElementById('sw-subtitle').textContent = `Until ${formatWindowDate(sw.windowEnd)}`;
    } else {
      const diff = new Date(sw.nextWindowStart) - now;
      if (diff <= 0) {
        cachedSyncWindow.inWindow = true;
        updateSyncWindowBanner();
        getAuth().then(auth => { if (auth) loadDashboard(auth); });
        return;
      }
      const nextStart = formatWindowDate(sw.nextWindowStart);
      const nextEnd = formatWindowDate(sw.nextWindowEnd);
      const relTime = formatRelativeTime(diff);
      document.getElementById('sw-subtitle').textContent = `${nextStart} \u2013 ${nextEnd} \u00B7 Come back ${relTime}`;
    }
  }, 60000);
}

// --- Monthly Breakdown ---
function renderMonthlyBreakdown(breakdown) {
  const section = document.getElementById('monthly-section');
  const list = document.getElementById('monthly-list');

  if (!breakdown.length) { section.style.display = 'none'; return; }

  section.style.display = '';
  list.innerHTML = '';

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const entry of breakdown) {
    const [yr, mo] = entry.month.split('-');
    const label = `${monthNames[parseInt(mo) - 1]} ${yr}`;
    const row = document.createElement('div');
    row.className = 'monthly-row';
    row.innerHTML = `<span class="monthly-month">${label}</span><span class="monthly-pts">+${entry.earned} pts</span>`;
    list.appendChild(row);
  }
}

document.getElementById('monthly-toggle')?.addEventListener('click', () => {
  const list = document.getElementById('monthly-list');
  const text = document.getElementById('monthly-toggle-text');
  if (list.style.display === 'none') {
    list.style.display = '';
    text.textContent = 'Hide';
  } else {
    list.style.display = 'none';
    text.textContent = 'Show';
  }
});

// --- Polling for progress + login state ---
function startPolling() {
  updateAllStatuses();
  pollInterval = setInterval(updateAllStatuses, 1500);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
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
  const badge = document.getElementById('pending-badge');
  if (count > 0) {
    badge.style.display = '';
    badge.textContent = `${count} trip${count !== 1 ? 's' : ''} pending sync`;
  } else {
    badge.style.display = 'none';
  }
}

// --- Progress step UI ---
function setStepState(stepId, state) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.className = `step-item ${state}`;
  const icon = el.querySelector('.step-icon');
  if (state === 'done') icon.textContent = '\u2713';
  else if (state === 'active') icon.innerHTML = '<span class="spinner"></span>';
  else if (state === 'error') icon.textContent = '\u2717';
}

function updateProgressUI(loginState, progress) {
  const uberState = loginState?.state || 'unknown';
  const step = progress?.step || null;
  const detail = document.getElementById('progress-detail');
  const barWrap = document.getElementById('progress-bar-wrap');
  const barFill = document.getElementById('progress-bar-fill');

  if (uberState === 'logged_in' || step) {
    setStepState('step-uber-login', 'done');
  } else if (uberState === 'logged_out') {
    setStepState('step-uber-login', 'active');
    detail.textContent = 'Please open the Uber Driver Portal and log in.';
    barWrap.style.display = 'none';
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
    setStepState('step-uber-login', '');
    detail.textContent = 'Click "Open Uber Driver Portal" to begin.';
    barWrap.style.display = 'none';
    return;
  }

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
  const result = (progress?.step === 'done') ? progress : lastResult;
  if (!result || result.created === undefined) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const hasErrors = (result.errors || 0) > 0;
  const outsideWindow = result.windowEligible === false;

  let cls = 'result-card';
  if (hasErrors) cls += ' has-errors';
  else if (outsideWindow) cls += ' outside-window';
  container.className = cls;

  const title = (progress?.step === 'done') ? 'Sync Complete!' : 'Last Sync Result';

  container.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">${title}</div>
    <div class="result-stat"><strong>${result.created || 0}</strong> New trips</div>
    <div class="result-stat"><strong>${result.duplicates || 0}</strong> Already synced</div>
    <div class="result-stat"><strong>+${result.totalPointsAwarded || result.pointsAwarded || 0}</strong> Points earned</div>
    ${hasErrors ? `<div style="font-size:11px;color:#dc2626;margin-top:4px">${result.errors} trips had errors</div>` : ''}
    ${outsideWindow ? `<div style="font-size:11px;color:#92400e;margin-top:6px">Trips stored but 0 points earned (outside sync window)</div>` : ''}
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
    text.textContent = 'Uber session: EXPIRED \u2014 please log in again';
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
  const countryCode = document.getElementById('login-country-code').value;
  const phoneNum = document.getElementById('login-phone').value.trim();
  const password = document.getElementById('login-password').value;

  if (!phoneNum || !password) { showError('Please fill in all fields'); return; }

  const phone = countryCode + phoneNum;

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
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
        phone: data.driver.phone,
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

let resetPhone = '';

document.getElementById('btn-show-forgot')?.addEventListener('click', (e) => {
  e.preventDefault();
  hideAllAuthForms();
  document.getElementById('forgot-form-wrap').style.display = '';
  const loginPhone = document.getElementById('login-phone').value.trim();
  if (loginPhone) document.getElementById('forgot-phone').value = loginPhone;
  document.getElementById('forgot-country-code').value = document.getElementById('login-country-code').value;
});

document.getElementById('btn-forgot-back')?.addEventListener('click', () => showLoginForm());
document.getElementById('btn-reset-back')?.addEventListener('click', () => showLoginForm());

document.getElementById('btn-send-code')?.addEventListener('click', async () => {
  const countryCode = document.getElementById('forgot-country-code').value;
  const phoneNum = document.getElementById('forgot-phone').value.trim();
  if (!phoneNum) { showError('Please enter your phone number'); return; }

  const phone = countryCode + phoneNum;
  const btn = document.getElementById('btn-send-code');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Failed to send code'); return; }

    resetPhone = phone;
    hideAllAuthForms();
    document.getElementById('reset-form-wrap').style.display = '';

    if (data._resetCode) {
      document.getElementById('reset-code').value = data._resetCode;
      showSuccess('Your reset code is ready. Please set a new password below.');
    } else {
      showSuccess('A reset code has been generated. Check server logs.');
    }
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
      body: JSON.stringify({ phone: resetPhone, code, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Reset failed'); return; }

    showLoginForm();
    showSuccess('Password reset! Please sign in with your new password.');
    document.getElementById('login-password').value = '';
    resetPhone = '';
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

document.getElementById('reg-region')?.addEventListener('change', () => {
  const region = document.getElementById('reg-region').value;
  document.getElementById('reg-country-code').value = region === 'HK' ? '+852' : '+55';
});

document.getElementById('btn-register').addEventListener('click', async () => {
  const name = document.getElementById('reg-name').value.trim();
  const countryCode = document.getElementById('reg-country-code').value;
  const phoneNum = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim() || undefined;
  const password = document.getElementById('reg-password').value;
  const region = document.getElementById('reg-region').value;
  const referralCode = document.getElementById('reg-referral').value.trim() || undefined;

  if (!name || !phoneNum || !password) { showError('Please fill in all required fields'); return; }
  if (password.length < 8) { showError('Password must be at least 8 characters'); return; }

  const phone = countryCode + phoneNum;

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, email, password, region, referralCode, consentDataCollection: true }),
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
        phone: data.driver.phone,
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
  document.getElementById('monthly-section').style.display = 'none';
  document.getElementById('sync-window-banner').style.display = 'none';
  document.getElementById('rewards-section').style.display = 'block';
  await loadRewardsUI();
});

document.getElementById('btn-back-main')?.addEventListener('click', () => {
  document.getElementById('rewards-section').style.display = 'none';
  document.getElementById('main-actions').style.display = '';
  document.getElementById('progress-section').style.display = '';
  document.getElementById('uber-session-bar').style.display = '';
  if (cachedSyncWindow) document.getElementById('sync-window-banner').style.display = 'flex';
  document.getElementById('monthly-section').style.display = '';
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
            <div class="gc-detail">${gc.provider} \u2014 ${gc.currency} ${gc.faceValue}</div>
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
            alert(`Request submitted! Your ${result.giftCardName} redemption is now being reviewed.`);
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

    const rdContainer = document.getElementById('my-redemptions');
    const rdList = document.getElementById('redemptions-list');
    if (rdRes.redemptions?.length > 0) {
      rdContainer.style.display = '';
      rdList.innerHTML = '';
      const statusCls = { PENDING: 'rd-pending', PROCESSING: 'rd-processing', FULFILLED: 'rd-fulfilled', FAILED: 'rd-failed', CANCELLED: 'rd-cancelled' };
      const statusLabels = { PENDING: 'Request Sent', PROCESSING: 'Under Review', FULFILLED: 'Gift Code Sent', FAILED: 'Failed', CANCELLED: 'Cancelled' };
      for (const rd of rdRes.redemptions) {
        const item = document.createElement('div');
        item.className = 'rd-item';
        let html = `
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:500">${rd.giftCardName || rd.giftCard?.name || 'Gift Card'}</span>
            <span class="rd-status ${statusCls[rd.status] || ''}">${statusLabels[rd.status] || rd.status}</span>
          </div>
          <div style="color:#888;font-size:11px;margin-top:2px">${new Date(rd.createdAt).toLocaleDateString()} \u2014 ${rd.pointsSpent} pts</div>
        `;
        if (rd.status === 'FULFILLED' && rd.giftCardCode) {
          const codeId = `gc-code-${rd.id}`;
          html += `
            <div class="gc-code" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span style="flex:1;word-break:break-all">${rd.giftCardCode}</span>
              <button class="gc-copy-btn" data-code="${rd.giftCardCode}" data-id="${codeId}" title="Copy code"
                style="flex-shrink:0;background:#d1fae5;border:1px solid #6ee7b7;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;color:#065f46;font-weight:600">
                Copy
              </button>
            </div>`;
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
      for (const btn of rdList.querySelectorAll('.gc-copy-btn')) {
        btn.addEventListener('click', (e) => {
          const code = e.currentTarget.dataset.code;
          navigator.clipboard.writeText(code).then(() => {
            e.currentTarget.textContent = 'Copied!';
            setTimeout(() => { e.currentTarget.textContent = 'Copy'; }, 2000);
          });
        });
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

document.getElementById('how-points-toggle')?.addEventListener('click', () => {
  const body = document.getElementById('how-points-body');
  const chevron = document.getElementById('how-points-chevron');
  const isOpen = body.classList.toggle('open');
  chevron.classList.toggle('open', isOpen);
});

init();
