// Session Keeper: Keeps the Uber driver portal session alive as long as possible.
//
// Strategy:
// 1. Monitor cookies for drivers.uber.com — detect session cookies and track expiry
// 2. Periodic heartbeat: load a lightweight Uber page in a hidden tab to refresh session cookies
// 3. Send heartbeat to our backend so admin can track session health
// 4. Notify driver if session is about to expire (needs re-login)

const UBER_ORIGIN = 'https://drivers.uber.com';
const HEARTBEAT_INTERVAL_MINUTES = 10;
const SESSION_REFRESH_INTERVAL_MINUTES = 30;
const API_BASE_URL = 'https://api.driversbonus.com';

let sessionRefreshTabId = null;

async function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['auth'], (result) => resolve(result.auth || null));
  });
}

// --- Cookie Monitoring ---

async function checkUberSessionCookies() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: '.uber.com' }, (cookies) => {
      const sessionCookies = cookies.filter(
        (c) =>
          c.name === 'sid' ||
          c.name === 'csid' ||
          c.name === 'jwt-session' ||
          c.name.includes('session') ||
          c.name.includes('auth'),
      );

      if (sessionCookies.length === 0) {
        resolve({ active: false, reason: 'no_session_cookies' });
        return;
      }

      const now = Date.now() / 1000;
      const expiringCookies = sessionCookies.filter(
        (c) => c.expirationDate && c.expirationDate - now < 3600,
      );

      const earliestExpiry = sessionCookies
        .filter((c) => c.expirationDate)
        .reduce((min, c) => Math.min(min, c.expirationDate), Infinity);

      const minutesUntilExpiry = earliestExpiry === Infinity
        ? null
        : Math.floor((earliestExpiry - now) / 60);

      resolve({
        active: true,
        cookieCount: sessionCookies.length,
        expiringCookies: expiringCookies.length,
        minutesUntilExpiry,
        cookies: sessionCookies.map((c) => ({
          name: c.name,
          expirationDate: c.expirationDate,
          httpOnly: c.httpOnly,
          secure: c.secure,
        })),
      });
    });
  });
}

// --- Session Refresh ---
// Opens a hidden tab to drivers.uber.com to trigger cookie renewal.
// Uber's session cookies are typically refreshed on page load.

async function refreshUberSession() {
  const sessionStatus = await checkUberSessionCookies();
  if (!sessionStatus.active) {
    notifySessionExpired();
    return;
  }

  // Only refresh if session is getting stale (< 2 hours until expiry) or on schedule
  if (sessionStatus.minutesUntilExpiry !== null && sessionStatus.minutesUntilExpiry > 120) {
    return; // session is healthy, no need to refresh yet
  }

  try {
    // Check if we already have a refresh tab
    if (sessionRefreshTabId) {
      try {
        await chrome.tabs.get(sessionRefreshTabId);
        // Tab exists, reload it
        chrome.tabs.reload(sessionRefreshTabId);
        return;
      } catch {
        sessionRefreshTabId = null;
      }
    }

    // Create a new hidden tab to refresh cookies
    const tab = await chrome.tabs.create({
      url: `${UBER_ORIGIN}/earnings`,
      active: false,
      pinned: false,
    });

    sessionRefreshTabId = tab.id;

    // Close the tab after it loads (give it 15 seconds)
    setTimeout(() => {
      if (sessionRefreshTabId === tab.id) {
        chrome.tabs.remove(tab.id).catch(() => {});
        sessionRefreshTabId = null;
      }
    }, 15_000);
  } catch (e) {
    console.error('[SessionKeeper] Failed to refresh session:', e);
  }
}

// --- Backend Heartbeat ---

async function sendHeartbeatToBackend() {
  const auth = await getAuth();
  if (!auth?.accessToken) return;

  try {
    await fetch(`${API_BASE_URL}/api/session/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ source: 'chrome_extension' }),
    });
  } catch {
    // Silently fail — backend heartbeat is best-effort
  }
}

// --- Notifications ---

function notifySessionExpired() {
  chrome.notifications.create('uber-session-expired', {
    type: 'basic',
    iconUrl: '../public/icons/icon-128.png',
    title: 'Uber Session Expired',
    message:
      'Your Uber driver portal session has expired. Please open the portal and log in again to continue earning rewards.',
    priority: 2,
    requireInteraction: true,
  });
}

function notifySessionExpiring(minutesLeft) {
  chrome.notifications.create('uber-session-expiring', {
    type: 'basic',
    iconUrl: '../public/icons/icon-128.png',
    title: 'Uber Session Expiring Soon',
    message: `Your Uber session will expire in about ${minutesLeft} minutes. Open the Uber driver portal to keep your session active.`,
    priority: 1,
  });
}

// --- Cookie Change Listener ---

chrome.cookies.onChanged.addListener((changeInfo) => {
  const { cookie, removed } = changeInfo;
  if (!cookie.domain.includes('uber.com')) return;

  if (removed && (cookie.name === 'sid' || cookie.name.includes('session'))) {
    checkUberSessionCookies().then((status) => {
      if (!status.active) {
        notifySessionExpired();
        // End session on backend
        getAuth().then((auth) => {
          if (!auth?.accessToken) return;
          fetch(`${API_BASE_URL}/api/session/end`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${auth.accessToken}`,
            },
            body: JSON.stringify({ source: 'chrome_extension' }),
          }).catch(() => {});
        });
      }
    });
  }
});

// --- Alarms ---

chrome.alarms.create('sessionHeartbeat', { periodInMinutes: HEARTBEAT_INTERVAL_MINUTES });
chrome.alarms.create('sessionRefresh', { periodInMinutes: SESSION_REFRESH_INTERVAL_MINUTES });
chrome.alarms.create('sessionCheck', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sessionHeartbeat') {
    await sendHeartbeatToBackend();
  }

  if (alarm.name === 'sessionRefresh') {
    await refreshUberSession();
  }

  if (alarm.name === 'sessionCheck') {
    const status = await checkUberSessionCookies();
    if (status.active && status.minutesUntilExpiry !== null) {
      if (status.minutesUntilExpiry < 30) {
        notifySessionExpiring(status.minutesUntilExpiry);
        await refreshUberSession();
      }
    }

    // Store session status for popup to display
    chrome.storage.local.set({
      uberSessionStatus: {
        ...status,
        checkedAt: new Date().toISOString(),
      },
    });
  }
});

// --- Exported for service-worker to import ---
export { checkUberSessionCookies, refreshUberSession, sendHeartbeatToBackend };
