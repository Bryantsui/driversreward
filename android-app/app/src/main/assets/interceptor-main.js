// Runs in MAIN world (page JS context).
// Detects Uber login state, captures API headers, fetches trips with progress updates.

(function () {
  'use strict';

  const FEED_PATH = '/earnings/api/getWebActivityFeed';
  const TRIP_PATH = '/earnings/api/getTrip';
  const WEEKS_TO_FETCH = 26;
  const DELAY_BETWEEN_TRIPS_MS = 150;
  const DELAY_BETWEEN_WEEKS_MS = 300;
  const PARALLEL_TRIP_FETCH = 3;

  let capturedHeaders = window.__drCapturedHeaders || null;
  let autoFetchStarted = false;
  const originalFetch = window.fetch;

  // If the early hook already captured headers before this script ran, trigger auto-fetch
  if (capturedHeaders && hasUsableHeaders(capturedHeaders)) {
    console.log('[DriversReward] Headers already available from early hook — triggering auto-fetch');
    setTimeout(() => {
      post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_in', message: 'Uber session active' }), '');
      triggerAutoFetch();
    }, 500);
  }

  // Periodically check if an external script (like Android's early hook) captured headers
  setInterval(() => {
    if (!capturedHeaders && window.__drCapturedHeaders && hasUsableHeaders(window.__drCapturedHeaders)) {
      capturedHeaders = window.__drCapturedHeaders;
      console.log('[DriversReward] Adopted headers from window.__drCapturedHeaders');
      if (loginCheckInterval) { clearInterval(loginCheckInterval); loginCheckInterval = null; }
      post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_in', message: 'Uber session active' }), '');
      triggerAutoFetch();
    }
  }, 1000);

  function post(type, body, url) {
    window.postMessage(
      {
        source: 'driversreward-interceptor',
        type,
        body: typeof body === 'string' ? body : JSON.stringify(body),
        url: url || '',
      },
      '*',
    );
  }

  function postProgress(step, detail) {
    post('PROGRESS_UPDATE', JSON.stringify({ step, ...detail }), '');
  }

  function extractHeaders(input, init) {
    const h = {};
    const collect = (src) => {
      if (src instanceof Headers) {
        src.forEach((v, k) => { h[k.toLowerCase()] = v; });
      } else if (src && typeof src === 'object' && !(src instanceof Headers)) {
        for (const [k, v] of Object.entries(src)) { h[k.toLowerCase()] = v; }
      }
    };
    if (input instanceof Request) collect(input.headers);
    if (init?.headers) collect(init.headers);
    return Object.keys(h).length > 0 ? h : null;
  }

  function hasUsableHeaders(h) {
    return h && h['x-csrf-token'];
  }

  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // --- Login detection ---
  // Uber's driver portal sets cookies and makes API calls only when logged in.
  // If we land on the login page, the URL contains /auth/login or there's no CSRF token.

  function detectLoginState() {
    const url = window.location.href;
    const isLoginPage = url.includes('/auth/login') || url.includes('/login') || url.includes('/auth/mfa') || url.includes('auth.uber.com');
    const isPortalPage = url.includes('drivers.uber.com') && !isLoginPage;

    if (isLoginPage) {
      post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_out', message: 'Please log in to your Uber Driver account' }), '');
      return 'logged_out';
    }

    if (capturedHeaders && hasUsableHeaders(capturedHeaders)) {
      post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_in', message: 'Uber session active' }), '');
      return 'logged_in';
    }

    if (isPortalPage) {
      post('UBER_LOGIN_STATE', JSON.stringify({ state: 'checking', message: 'Verifying Uber session...' }), '');
      return 'checking';
    }

    post('UBER_LOGIN_STATE', JSON.stringify({ state: 'unknown', message: 'Waiting for Uber portal to load...' }), '');
    return 'unknown';
  }

  // Run detection on page load and periodically until confirmed
  let loginCheckInterval = null;
  function startLoginCheck() {
    detectLoginState();
    loginCheckInterval = setInterval(() => {
      const state = detectLoginState();
      if (state === 'logged_in') {
        clearInterval(loginCheckInterval);
        loginCheckInterval = null;
      }
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLoginCheck);
  } else {
    startLoginCheck();
  }

  // Also detect from URL changes (SPA navigation)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      detectLoginState();
    }
  }).observe(document, { subtree: true, childList: true });

  // --- Fetch override ---
  window.fetch = async function (...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url || '';

    if (!hasUsableHeaders(capturedHeaders)) {
      const h = extractHeaders(input, init);
      if (hasUsableHeaders(h)) {
        capturedHeaders = h;
        console.log('[DriversReward] Captured headers from fetch');
        if (loginCheckInterval) { clearInterval(loginCheckInterval); loginCheckInterval = null; }
        post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_in', message: 'Uber session active' }), '');
        post('UBER_CSRF_CAPTURED', JSON.stringify({ csrfToken: h['x-csrf-token'] }), '');
        triggerAutoFetch();
      }
    }

    const response = await originalFetch.apply(this, args);

    if (url.includes(TRIP_PATH) || url.includes(FEED_PATH)) {
      const cloned = response.clone();
      cloned.text().then((body) => {
        post(
          url.includes(TRIP_PATH) ? 'UBER_TRIP_CAPTURED' : 'UBER_ACTIVITY_FEED_CAPTURED',
          body,
          url,
        );
      }).catch(() => {});
    }

    return response;
  };

  // --- XHR override ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._rwUrl = url;
    this._rwHeaders = {};
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    if (this._rwHeaders) this._rwHeaders[key.toLowerCase()] = value;
    return origSetHeader.call(this, key, value);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (!hasUsableHeaders(capturedHeaders) && hasUsableHeaders(this._rwHeaders)) {
      capturedHeaders = { ...this._rwHeaders };
      console.log('[DriversReward] Captured headers from XHR');
      if (loginCheckInterval) { clearInterval(loginCheckInterval); loginCheckInterval = null; }
      post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_in', message: 'Uber session active' }), '');
      post('UBER_CSRF_CAPTURED', JSON.stringify({ csrfToken: capturedHeaders['x-csrf-token'] }), '');
      triggerAutoFetch();
    }

    this.addEventListener('load', function () {
      const reqUrl = this._rwUrl || '';
      if (reqUrl.includes(TRIP_PATH) || reqUrl.includes(FEED_PATH)) {
        post(
          reqUrl.includes(TRIP_PATH) ? 'UBER_TRIP_CAPTURED' : 'UBER_ACTIVITY_FEED_CAPTURED',
          this.responseText,
          reqUrl,
        );
      }
    });

    return origSend.apply(this, args);
  };

  // --- Auto-fetch ---
  function triggerAutoFetch() {
    if (autoFetchStarted) return;
    autoFetchStarted = true;
    postProgress('starting', { message: 'Starting trip data collection...' });
    setTimeout(() => autoFetchTrips(), 3000);
  }

  async function fetchFeedWeek(startDate, endDate, allTrips, allBonuses) {
    const body = JSON.stringify({
      startDateIso: fmtDate(startDate),
      endDateIso: fmtDate(endDate),
      paginationOption: {},
    });

    let hasMore = true;
    let paginationOption = {};
    let pageNum = 0;

    while (hasMore) {
      pageNum++;
      const reqBody = pageNum === 1
        ? body
        : JSON.stringify({ startDateIso: fmtDate(startDate), endDateIso: fmtDate(endDate), paginationOption });

      try {
        const res = await originalFetch(`${FEED_PATH}?localeCode=en`, {
          method: 'POST',
          headers: { ...capturedHeaders, 'content-type': 'application/json' },
          body: reqBody,
          credentials: 'include',
        });

        if (!res.ok) break;

        const text = await res.text();
        const parsed = JSON.parse(text);

        if (parsed.status !== 'success') break;

        const activities = parsed.data?.activities || [];
        for (const act of activities) {
          if (!act.uuid) continue;
          if (act.type === 'TRIP') {
            allTrips.push(act);
          } else {
            allBonuses.push(act);
          }
        }

        post('UBER_ACTIVITY_FEED_CAPTURED', text, FEED_PATH);

        if (parsed.data?.paginationOption?.hasMore) {
          paginationOption = parsed.data.paginationOption;
          await sleep(DELAY_BETWEEN_WEEKS_MS);
        } else {
          hasMore = false;
        }
      } catch {
        hasMore = false;
      }
    }
  }

  async function autoFetchTrips() {
    if (!capturedHeaders) return;

    console.log(`[DriversReward] Auto-fetching last ${WEEKS_TO_FETCH} weeks of trips...`);
    postProgress('fetching_history', { message: 'Scanning trip history...', week: 0, totalWeeks: WEEKS_TO_FETCH });

    const allTrips = [];
    const allBonuses = [];

    for (let w = 0; w < WEEKS_TO_FETCH; w++) {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - w * 7);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 7);

      const endPlusOne = new Date(endDate);
      endPlusOne.setDate(endPlusOne.getDate() + 1);

      postProgress('fetching_history', {
        message: `Scanning trip history (week ${w + 1}/${WEEKS_TO_FETCH})...`,
        week: w + 1,
        totalWeeks: WEEKS_TO_FETCH,
      });

      console.log(`[DriversReward] Week ${w + 1}: ${fmtDate(startDate)} → ${fmtDate(endPlusOne)}`);
      await fetchFeedWeek(startDate, endPlusOne, allTrips, allBonuses);
      await sleep(DELAY_BETWEEN_WEEKS_MS);
    }

    // Deduplicate trips
    const seen = new Set();
    const uniqueTrips = allTrips.filter((t) => {
      if (seen.has(t.uuid)) return false;
      seen.add(t.uuid);
      return true;
    });

    // Deduplicate bonuses
    const seenBonuses = new Set();
    const uniqueBonuses = allBonuses.filter((b) => {
      if (seenBonuses.has(b.uuid)) return false;
      seenBonuses.add(b.uuid);
      return true;
    });

    if (uniqueBonuses.length > 0) {
      console.log(`[DriversReward] Found ${uniqueBonuses.length} bonus/quest activities`);
      post('UBER_BONUSES_CAPTURED', JSON.stringify(uniqueBonuses), '');
    }

    const totalItems = uniqueTrips.length + uniqueBonuses.length;
    console.log(`[DriversReward] Found ${uniqueTrips.length} trips + ${uniqueBonuses.length} bonuses — fetching trip details...`);
    postProgress('fetching_details', {
      message: `Found ${uniqueTrips.length} trips. Fetching details...`,
      fetched: 0,
      total: uniqueTrips.length,
    });

    let fetched = 0;
    for (let i = 0; i < uniqueTrips.length; i += PARALLEL_TRIP_FETCH) {
      const batch = uniqueTrips.slice(i, i + PARALLEL_TRIP_FETCH);
      const promises = batch.map(async (trip) => {
        try {
          const res = await originalFetch(`${TRIP_PATH}?localeCode=en`, {
            method: 'POST',
            headers: { ...capturedHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ tripUUID: trip.uuid }),
            credentials: 'include',
          });
          if (res.ok) {
            const text = await res.text();
            post('UBER_TRIP_CAPTURED', text, `${TRIP_PATH}?uuid=${trip.uuid}`);
            return true;
          }
        } catch {}
        return false;
      });
      const results = await Promise.all(promises);
      fetched += results.filter(Boolean).length;

      postProgress('fetching_details', {
        message: `Fetching trip details (${fetched}/${uniqueTrips.length})...`,
        fetched,
        total: uniqueTrips.length,
      });

      if (i + PARALLEL_TRIP_FETCH < uniqueTrips.length) await sleep(DELAY_BETWEEN_TRIPS_MS);
    }

    console.log(`[DriversReward] Complete: ${fetched}/${uniqueTrips.length} trips captured, ${uniqueBonuses.length} bonuses`);
    postProgress('submitting', { message: 'Sending trip data to server...', fetched, total: uniqueTrips.length });
    await sleep(2000);
    post('AUTO_FETCH_COMPLETE', JSON.stringify({ total: uniqueTrips.length, fetched, bonuses: uniqueBonuses.length }), '');
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
