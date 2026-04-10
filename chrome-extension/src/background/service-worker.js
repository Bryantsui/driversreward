// Background service worker: forwards raw Uber API responses to backend for server-side parsing.
// Tracks Uber login state and fetch progress for the popup UI.

import { checkUberSessionCookies, refreshUberSession, sendHeartbeatToBackend } from './session-keeper.js';

// Configurable via chrome.storage.local.set({ apiBaseUrl: 'https://api.driversreward.com' })
// Defaults to production API
let API_BASE_URL = 'https://api.driversreward.com';
chrome.storage.local.get('apiBaseUrl', (r) => { if (r.apiBaseUrl) API_BASE_URL = r.apiBaseUrl; });

let rawTripQueue = [];
let syncInProgress = false;

async function uploadUberCredentials(source) {
  try {
    const auth = await getValidAuth();
    if (!auth) return;

    // Get Uber cookies
    const cookies = await new Promise((resolve) => {
      chrome.cookies.getAll({ domain: '.uber.com' }, (c) => resolve(c));
    });
    if (!cookies || cookies.length === 0) return;

    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // Get stored CSRF token
    const stored = await new Promise((resolve) => {
      chrome.storage.local.get(['uberCsrfToken'], (r) => resolve(r));
    });
    const csrfToken = stored.uberCsrfToken;
    if (!csrfToken) return;

    const res = await fetch(`${API_BASE_URL}/api/session/store-credential`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({
        cookies: cookieString,
        csrfToken,
        userAgent: navigator.userAgent,
        source,
      }),
    });

    if (!res.ok) {
      console.debug('[DriversReward] Session sync status:', res.status);
    }
  } catch (_) { }
}
let autoFetchInProgress = false;
let queueDrainTimer = null;

chrome.storage.local.get(['rawTripQueue'], (result) => {
  if (result.rawTripQueue) rawTripQueue = result.rawTripQueue;
});

function saveQueue() {
  chrome.storage.local.set({ rawTripQueue });
}

async function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['auth'], (result) => resolve(result.auth || null));
  });
}

async function refreshToken(auth) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const newAuth = { ...auth, accessToken: data.accessToken, refreshToken: data.refreshToken };
    chrome.storage.local.set({ auth: newAuth });
    console.log('[DriversReward] Token refreshed successfully');
    return newAuth;
  } catch {
    return null;
  }
}

async function getValidAuth() {
  let auth = await getAuth();
  if (!auth) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/rewards/balance`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (res.status === 401) {
      console.log('[DriversReward] Access token expired, refreshing...');
      auth = await refreshToken(auth);
    }
  } catch {}

  return auth;
}

function extractUuidFromUrl(url) {
  if (!url) return '';
  try {
    const match = url.match(/[?&]uuid=([^&]+)/);
    if (match) return match[1];
  } catch {}
  return '';
}

async function submitRawTrips(rawTrips, source) {
  const auth = await getValidAuth();
  if (!auth) {
    console.warn('[DriversReward] Not authenticated — cannot submit trips');
    return { success: false, reason: 'not_authenticated' };
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/ingest/raw-trips`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ trips: rawTrips, source }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[DriversReward] Backend rejected:', res.status, JSON.stringify(data));
      return { success: false, reason: data.code || 'api_error', detail: data };
    }

    console.log(`[DriversReward] Backend accepted: ${data.created} created, ${data.duplicates} dupes, ${data.errors} errors, ${data.totalPointsAwarded} pts`);
    return { success: true, data };
  } catch (e) {
    console.error('[DriversReward] Network error submitting trips:', e.message);
    return { success: false, reason: 'network_error' };
  }
}

async function processQueue() {
  if (syncInProgress || rawTripQueue.length === 0) return;
  syncInProgress = true;

  // Accumulate totals across batches for the final result
  let totalCreated = 0, totalDuplicates = 0, totalErrors = 0, totalPoints = 0;

  try {
    while (rawTripQueue.length > 0) {
      const queueLen = rawTripQueue.length;
      updateProgress({ step: 'submitting', message: `Syncing ${queueLen} trip${queueLen > 1 ? 's' : ''} to server...` });

      const batch = rawTripQueue.slice(0, 20);
      console.log(`[DriversReward] Submitting batch of ${batch.length} raw trips (${rawTripQueue.length} total remaining)...`);

      const result = await submitRawTrips(batch, 'chrome_extension');

      if (result.success) {
        rawTripQueue = rawTripQueue.slice(batch.length);
        saveQueue();

        totalCreated += result.data.created || 0;
        totalDuplicates += result.data.duplicates || 0;
        totalErrors += result.data.errors || 0;
        totalPoints += result.data.totalPointsAwarded || 0;

        chrome.action.setBadgeText({
          text: rawTripQueue.length > 0 ? String(rawTripQueue.length) : '',
        });

        if (rawTripQueue.length > 0) {
          await new Promise(r => setTimeout(r, 500));
        }
      } else {
        console.error('[DriversReward] Batch failed:', result.reason);
        updateProgress({ step: 'error', message: `Sync failed: ${result.reason}` });
        return;
      }
    }

    // All batches done
    const combinedResult = {
      created: totalCreated,
      duplicates: totalDuplicates,
      errors: totalErrors,
      totalPointsAwarded: totalPoints,
    };

    chrome.storage.local.set({
      lastSync: new Date().toISOString(),
      lastSyncResult: combinedResult,
    });

    updateProgress({
      step: 'done',
      message: 'Sync complete!',
      created: totalCreated,
      duplicates: totalDuplicates,
      errors: totalErrors,
      pointsAwarded: totalPoints,
    });

    console.log(`[DriversReward] Sync complete: ${totalCreated} new, ${totalDuplicates} dupes, ${totalErrors} errors, ${totalPoints} pts`);
  } finally {
    syncInProgress = false;
  }
}

function updateProgress(data) {
  chrome.storage.local.set({ fetchProgress: { ...data, updatedAt: Date.now() } });
}

// --- Message handlers ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UBER_TRIP_CAPTURED') {
    const rawBody = message.rawBody;
    if (!rawBody || rawBody.length < 50) return;

    try {
      const peek = JSON.parse(rawBody);
      if (peek.status === 'failure') {
        console.log('[DriversReward] Skipping Uber error response');
        return;
      }
    } catch { return; }

    const tripUuid = extractUuidFromUrl(message.url);

    rawTripQueue.push({ rawBody, tripUuid, url: message.url || '' });
    saveQueue();

    console.log(`[DriversReward] Trip queued: ${tripUuid || '(uuid from body)'} (${rawBody.length} bytes) — queue: ${rawTripQueue.length}`);
    chrome.action.setBadgeText({ text: String(rawTripQueue.length) });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

    // During auto-fetch, don't submit per-trip — wait for AUTO_FETCH_COMPLETE.
    // Otherwise (manual or straggler), debounce-drain after 3s of no new trips.
    if (!autoFetchInProgress) {
      if (queueDrainTimer) clearTimeout(queueDrainTimer);
      queueDrainTimer = setTimeout(() => processQueue(), 3000);
    }
  }

  if (message.type === 'UBER_ACTIVITY_FEED_CAPTURED') {
    (async () => {
      const auth = await getValidAuth();
      if (!auth) return;

      try {
        const raw = JSON.parse(message.rawBody);
        const activities = (raw.data?.activities || raw.activities || []).map((a) => ({
          uuid: a.uuid || '',
          activityTitle: a.activityTitle || a.title || '',
          formattedTotal: a.formattedTotal || a.total || '',
          type: a.type || 'UNKNOWN',
        }));

        if (activities.length === 0) return;

        await fetch(`${API_BASE_URL}/api/ingest/activity-feed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({
            startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            endDate: new Date().toISOString().split('T')[0],
            trips: activities,
            source: 'chrome_extension',
          }),
        });
      } catch {}
    })();
  }

  if (message.type === 'UBER_LOGIN_STATE') {
    try {
      const data = JSON.parse(message.rawBody);
      chrome.storage.local.set({ uberLoginState: data });
    } catch {}
  }

  if (message.type === 'PROGRESS_UPDATE') {
    try {
      const data = JSON.parse(message.rawBody);
      // Track when auto-fetch is active so we don't submit prematurely
      if (data.step === 'starting' || data.step === 'fetching_history' || data.step === 'fetching_details') {
        autoFetchInProgress = true;
      }
      updateProgress(data);
    } catch {}
  }

  if (message.type === 'AUTO_FETCH_COMPLETE') {
    autoFetchInProgress = false;
    console.log(`[DriversReward] Auto-fetch complete — flushing ${rawTripQueue.length} queued trips...`);
    // Small delay to let the last UBER_TRIP_CAPTURED messages arrive
    setTimeout(() => processQueue(), 1500);

    // After sync completes, upload Uber session credentials for server-side scraping
    uploadUberCredentials('chrome_extension');
  }

  if (message.type === 'UBER_BONUSES_CAPTURED') {
    (async () => {
      const auth = await getValidAuth();
      if (!auth) return;

      try {
        const bonuses = JSON.parse(message.rawBody);
        if (!Array.isArray(bonuses) || bonuses.length === 0) return;

        const payload = bonuses.map((b) => ({
          uuid: b.uuid,
          activityType: b.type || 'BONUS',
          activityTitle: b.activityTitle || '',
          formattedTotal: b.formattedTotal || '',
          recognizedAt: b.recognizedAt || 0,
        }));

        const res = await fetch(`${auth.serverUrl}/api/ingest/raw-bonuses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({ bonuses: payload, source: 'chrome_extension' }),
        });

        if (res.ok) {
          const data = await res.json();
          console.log(`[DriversReward] Bonuses submitted: created=${data.created}, dupes=${data.duplicates}`);
        } else {
          console.warn(`[DriversReward] Bonus submission failed: ${res.status}`);
        }
      } catch (err) {
        console.error('[DriversReward] Error submitting bonuses:', err);
      }
    })();
  }

  if (message.type === 'UBER_CSRF_CAPTURED') {
    try {
      const data = JSON.parse(message.rawBody);
      chrome.storage.local.set({ uberCsrfToken: data.csrfToken });
    } catch {}
  }

  if (message.type === 'GET_SYNC_STATUS') {
    chrome.storage.local.get(['lastSync', 'lastSyncResult'], (result) => {
      sendResponse({
        pending: rawTripQueue.length,
        lastSync: result.lastSync,
        lastResult: result.lastSyncResult,
      });
    });
    return true;
  }

  if (message.type === 'GET_AUTH') {
    getAuth().then((auth) => sendResponse(auth));
    return true;
  }

  if (message.type === 'SET_AUTH') {
    chrome.storage.local.set({ auth: message.auth });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'LOGOUT') {
    chrome.storage.local.remove(['auth', 'lastSync', 'lastSyncResult', 'rawTripQueue', 'fetchProgress', 'uberLoginState']);
    rawTripQueue = [];
    sendResponse({ success: true });
    return true;
  }
});

chrome.alarms.create('syncRetry', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncRetry') processQueue();
});
