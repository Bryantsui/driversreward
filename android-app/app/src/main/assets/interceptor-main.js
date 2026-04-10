// Runs in MAIN world (page JS context).
// Detects Uber login state, captures API headers, fetches trips with progress updates.
// Renders an in-page overlay for sync progress (avoids native/Compose layering issues).

(function () {
  'use strict';

  const FEED_PATH = '/earnings/api/getWebActivityFeed';
  const TRIP_PATH = '/earnings/api/getTrip';
  const WEEKS_TO_FETCH = 26;
  const DELAY_BETWEEN_TRIPS_MS = 50;
  const DELAY_BETWEEN_WEEKS_MS = 80;
  const PARALLEL_TRIP_FETCH = 5;

  let capturedHeaders = window.__drCapturedHeaders || null;
  let autoFetchStarted = false;
  const originalFetch = window.fetch;

  // ── In-page overlay ──────────────────────────────────────────────

  const OVERLAY_ID = '__dr_sync_overlay';
  const OVERLAY_CSS = `
    #${OVERLAY_ID} {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: opacity .4s ease;
    }
    #${OVERLAY_ID}.dr-hidden { opacity: 0; pointer-events: none; }
    #${OVERLAY_ID} .dr-bg {
      position: absolute; inset: 0;
      background: linear-gradient(165deg, #312e81 0%, #4338ca 50%, #4f46e5 100%);
    }
    #${OVERLAY_ID}.dr-done .dr-bg {
      background: linear-gradient(165deg, #059669 0%, #10b981 100%);
    }
    #${OVERLAY_ID} .dr-content {
      position: relative; z-index: 1; text-align: center; padding: 0 32px; width: 100%;
      max-width: 380px;
    }

    /* Spinning rings */
    .dr-rings { width: 120px; height: 120px; margin: 0 auto 24px; position: relative; }
    .dr-ring {
      position: absolute; inset: 0; border-radius: 50%;
      border: 3px solid transparent; border-top-color: rgba(255,255,255,.35);
    }
    .dr-ring-1 { animation: drSpin 2s linear infinite; }
    .dr-ring-2 {
      inset: 10px; border-width: 2px; border-top-color: rgba(255,255,255,.2);
      animation: drSpin 2.8s linear infinite reverse;
    }
    .dr-ring-icon {
      position: absolute; inset: 24px; border-radius: 50%;
      background: rgba(255,255,255,.12);
      display: flex; align-items: center; justify-content: center;
      font-size: 36px;
      animation: drPulse 1.4s ease-in-out infinite alternate;
    }
    @keyframes drSpin { to { transform: rotate(360deg); } }
    @keyframes drPulse { from { transform: scale(.9); } to { transform: scale(1.08); } }

    /* Completion icon */
    .dr-check {
      width: 100px; height: 100px; margin: 0 auto 24px; border-radius: 50%;
      background: rgba(255,255,255,.2); display: flex; align-items: center; justify-content: center;
      font-size: 48px; animation: drBounceIn .6s cubic-bezier(.34,1.56,.64,1) both;
    }
    @keyframes drBounceIn { from { transform: scale(0); } to { transform: scale(1); } }

    /* Text */
    .dr-title {
      color: #fff; font-size: 22px; font-weight: 700; margin: 0 0 6px; line-height: 1.3;
    }
    .dr-sub {
      color: rgba(255,255,255,.75); font-size: 14px; margin: 0 0 28px; line-height: 1.4;
    }

    /* Step timeline */
    .dr-steps { display: flex; align-items: flex-start; justify-content: center; gap: 0; margin-bottom: 24px; }
    .dr-step { display: flex; flex-direction: column; align-items: center; width: 90px; }
    .dr-dot {
      width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; color: #4f46e5; transition: all .3s ease;
    }
    .dr-dot.pending { background: rgba(255,255,255,.12); color: rgba(255,255,255,.35); }
    .dr-dot.active {
      background: #fff; color: #4f46e5; box-shadow: 0 0 12px rgba(255,255,255,.4);
      animation: drDotPulse .9s ease-in-out infinite alternate;
    }
    .dr-dot.done { background: rgba(255,255,255,.85); color: #059669; }
    @keyframes drDotPulse { from { transform: scale(1); } to { transform: scale(1.15); } }
    .dr-step-label {
      font-size: 10px; margin-top: 5px; color: rgba(255,255,255,.45);
      line-height: 1.2; text-align: center;
    }
    .dr-step-label.active { color: #fff; font-weight: 600; }
    .dr-step-label.done { color: rgba(255,255,255,.7); }
    .dr-line {
      width: 20px; height: 2px; margin-top: 14px; flex-shrink: 0;
      background: rgba(255,255,255,.12); transition: background .3s ease;
    }
    .dr-line.done { background: rgba(255,255,255,.5); }

    /* Progress bar */
    .dr-progress-wrap {
      width: 100%; height: 6px; border-radius: 3px; background: rgba(255,255,255,.15);
      overflow: hidden; margin-bottom: 6px;
    }
    .dr-progress-bar {
      height: 100%; border-radius: 3px; transition: width .4s cubic-bezier(.33,1,.68,1);
      background: linear-gradient(90deg, rgba(255,255,255,.6), #fff);
      width: 0%;
    }
    .dr-pct { color: rgba(255,255,255,.5); font-size: 12px; font-weight: 500; margin-bottom: 24px; }

    /* Dismiss link */
    .dr-dismiss {
      color: rgba(255,255,255,.55); font-size: 13px; background: none; border: none;
      cursor: pointer; padding: 8px 16px; text-decoration: underline;
    }
    .dr-dismiss:hover { color: rgba(255,255,255,.8); }

    /* Done button */
    .dr-done-btn {
      color: #fff; font-size: 15px; font-weight: 600; background: rgba(255,255,255,.2);
      border: none; border-radius: 12px; padding: 12px 32px; cursor: pointer;
      margin-top: 16px;
    }
    .dr-done-btn:hover { background: rgba(255,255,255,.3); }

    .dr-hint {
      color: rgba(255,255,255,.5); font-size: 12px; margin-top: 12px; line-height: 1.5;
    }
  `;

  function injectOverlayStyle() {
    if (document.getElementById('dr-sync-css')) return;
    var s = document.createElement('style');
    s.id = 'dr-sync-css';
    s.textContent = OVERLAY_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function getOrCreateOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    injectOverlayStyle();
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = 'dr-hidden';
    el.innerHTML = buildOverlayHTML('starting', '', 0, 0, 0);
    (document.body || document.documentElement).appendChild(el);
    // Force reflow then show
    void el.offsetWidth;
    el.classList.remove('dr-hidden');
    return el;
  }

  function buildOverlayHTML(step, message, progress, total, stepIndex) {
    var isComplete = step === 'complete';
    var pct = total > 0 ? Math.round((progress / total) * 100) : (step === 'submitting' ? 85 : 0);
    if (isComplete) pct = 100;

    var icon = step === 'fetching_details' ? '\uD83D\uDCB0'
             : step === 'submitting' ? '\u2601\uFE0F'
             : '\uD83D\uDD0D';

    var title = isComplete ? 'Points Updated!'
              : step === 'fetching_details' ? 'Calculating Rewards'
              : step === 'submitting' ? 'Finalizing Point Balance'
              : 'Scanning Trip History';

    var sub = isComplete ? 'Your reward points are up to date'
            : message || 'Collecting your trip data...';

    var stepsHTML = '';
    if (!isComplete) {
      var labels = ['Scanning Trips', 'Calculating Rewards', 'Finalizing Balance'];
      stepsHTML = '<div class="dr-steps">';
      for (var i = 0; i < labels.length; i++) {
        var cls = (i + 1) < stepIndex ? 'done' : (i + 1) === stepIndex ? 'active' : 'pending';
        var dotContent = cls === 'done' ? '\u2713' : cls === 'active' ? '\u21BB' : '';
        stepsHTML += '<div class="dr-step">'
          + '<div class="dr-dot ' + cls + '">' + dotContent + '</div>'
          + '<div class="dr-step-label ' + cls + '">' + labels[i] + '</div>'
          + '</div>';
        if (i < labels.length - 1) {
          stepsHTML += '<div class="dr-line ' + ((i + 1) < stepIndex ? 'done' : '') + '"></div>';
        }
      }
      stepsHTML += '</div>';
    }

    var centerHTML = '';
    if (isComplete) {
      centerHTML = '<div class="dr-check">\uD83C\uDF89</div>';
    } else {
      centerHTML = '<div class="dr-rings">'
        + '<div class="dr-ring dr-ring-1"></div>'
        + '<div class="dr-ring dr-ring-2"></div>'
        + '<div class="dr-ring-icon">' + icon + '</div>'
        + '</div>';
    }

    var progressHTML = '';
    if (!isComplete && pct > 0) {
      progressHTML = '<div class="dr-progress-wrap"><div class="dr-progress-bar" style="width:' + pct + '%"></div></div>'
        + '<div class="dr-pct">' + pct + '%</div>';
    }

    var actionsHTML = '';
    if (isComplete) {
      actionsHTML = '<div class="dr-hint">Returning to home...</div>';
    }

    return '<div class="dr-bg"></div>'
      + '<div class="dr-content">'
      + centerHTML
      + '<h2 class="dr-title">' + title + '</h2>'
      + '<p class="dr-sub">' + sub + '</p>'
      + stepsHTML
      + progressHTML
      + actionsHTML
      + '</div>';
  }

  function updateOverlay(step, message, progress, total) {
    var stepIndex = step === 'starting' || step === 'fetching_history' ? 1
                  : step === 'fetching_details' ? 2
                  : step === 'submitting' ? 3
                  : step === 'complete' ? 4 : 1;

    var el = getOrCreateOverlay();
    el.innerHTML = buildOverlayHTML(step, message, progress, total, stepIndex);
    if (step === 'complete') {
      el.classList.add('dr-done');
      // Auto-dismiss after 5 seconds
      setTimeout(function() {
        el.classList.add('dr-hidden');
        setTimeout(function() { if (el.parentNode) el.remove(); }, 500);
      }, 5000);
    } else {
      el.classList.remove('dr-done', 'dr-hidden');
    }
  }

  function removeOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) {
      el.classList.add('dr-hidden');
      setTimeout(function() { if (el.parentNode) el.remove(); }, 500);
    }
  }

  // ── End overlay ──────────────────────────────────────────────────


  if (capturedHeaders && hasUsableHeaders(capturedHeaders)) {
    console.log('[DriversReward] Headers already available from early hook — triggering auto-fetch');
    post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_in', message: 'Uber session active' }), '');
    triggerAutoFetch();
  }

  setInterval(function() {
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
        type: type,
        body: typeof body === 'string' ? body : JSON.stringify(body),
        url: url || '',
      },
      '*'
    );
  }

  function postProgress(step, detail) {
    post('PROGRESS_UPDATE', JSON.stringify({ step: step, message: detail.message || '', fetched: detail.fetched || detail.week || 0, total: detail.total || detail.totalWeeks || 0 }), '');
    // Also update the in-page overlay directly (no round-trip through native bridge)
    updateOverlay(step, detail.message || '', detail.fetched || detail.week || 0, detail.total || detail.totalWeeks || 0);
  }

  function extractHeaders(input, init) {
    var h = {};
    var collect = function(src) {
      if (src instanceof Headers) {
        src.forEach(function(v, k) { h[k.toLowerCase()] = v; });
      } else if (src && typeof src === 'object' && !(src instanceof Headers)) {
        for (var k in src) { if (src.hasOwnProperty(k)) h[k.toLowerCase()] = src[k]; }
      }
    };
    if (input instanceof Request) collect(input.headers);
    if (init && init.headers) collect(init.headers);
    return Object.keys(h).length > 0 ? h : null;
  }

  function hasUsableHeaders(h) {
    return h && h['x-csrf-token'];
  }

  function fmtDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // --- Login detection ---
  function detectLoginState() {
    var url = window.location.href;
    var isLoginPage = url.includes('/auth/login') || url.includes('/login') || url.includes('/auth/mfa') || url.includes('auth.uber.com');
    var isPortalPage = url.includes('drivers.uber.com') && !isLoginPage;

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

  var loginCheckInterval = null;
  function startLoginCheck() {
    detectLoginState();
    loginCheckInterval = setInterval(function() {
      var state = detectLoginState();
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

  var lastUrl = location.href;
  new MutationObserver(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      detectLoginState();
    }
  }).observe(document, { subtree: true, childList: true });

  // --- Fetch override ---
  window.fetch = async function () {
    var args = Array.prototype.slice.call(arguments);
    var input = args[0], init = args[1];
    var url = typeof input === 'string' ? input : (input && input.url) || '';

    if (!hasUsableHeaders(capturedHeaders)) {
      var h = extractHeaders(input, init);
      if (hasUsableHeaders(h)) {
        capturedHeaders = h;
        console.log('[DriversReward] Captured headers from fetch');
        if (loginCheckInterval) { clearInterval(loginCheckInterval); loginCheckInterval = null; }
        post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_in', message: 'Uber session active' }), '');
        post('UBER_CSRF_CAPTURED', JSON.stringify({ csrfToken: h['x-csrf-token'] }), '');
        triggerAutoFetch();
      }
    }

    var response = await originalFetch.apply(this, args);

    if (url.includes(TRIP_PATH) || url.includes(FEED_PATH)) {
      var cloned = response.clone();
      cloned.text().then(function(body) {
        post(
          url.includes(TRIP_PATH) ? 'UBER_TRIP_CAPTURED' : 'UBER_ACTIVITY_FEED_CAPTURED',
          body,
          url
        );
      }).catch(function() {});
    }

    // Discovery: capture any /earnings/api/ call we don't already handle
    if (url.includes('/earnings/api/') && !url.includes(TRIP_PATH) && !url.includes(FEED_PATH)) {
      var discoveryClone = response.clone();
      discoveryClone.text().then(function(body) {
        console.log('[DriversReward] DISCOVERY API: ' + url);
        console.log('[DriversReward] DISCOVERY BODY: ' + body.substring(0, 2000));
        post('UBER_API_DISCOVERY', body, url);
      }).catch(function() {});
    }

    return response;
  };

  // --- XHR override ---
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._rwUrl = url;
    this._rwHeaders = {};
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    if (this._rwHeaders) this._rwHeaders[key.toLowerCase()] = value;
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (!hasUsableHeaders(capturedHeaders) && hasUsableHeaders(this._rwHeaders)) {
      capturedHeaders = Object.assign({}, this._rwHeaders);
      console.log('[DriversReward] Captured headers from XHR');
      if (loginCheckInterval) { clearInterval(loginCheckInterval); loginCheckInterval = null; }
      post('UBER_LOGIN_STATE', JSON.stringify({ state: 'logged_in', message: 'Uber session active' }), '');
      post('UBER_CSRF_CAPTURED', JSON.stringify({ csrfToken: capturedHeaders['x-csrf-token'] }), '');
      triggerAutoFetch();
    }

    this.addEventListener('load', function () {
      var reqUrl = this._rwUrl || '';
      if (reqUrl.includes(TRIP_PATH) || reqUrl.includes(FEED_PATH)) {
        post(
          reqUrl.includes(TRIP_PATH) ? 'UBER_TRIP_CAPTURED' : 'UBER_ACTIVITY_FEED_CAPTURED',
          this.responseText,
          reqUrl
        );
      }
      if (reqUrl.includes('/earnings/api/') && !reqUrl.includes(TRIP_PATH) && !reqUrl.includes(FEED_PATH)) {
        console.log('[DriversReward] DISCOVERY XHR API: ' + reqUrl);
        console.log('[DriversReward] DISCOVERY XHR BODY: ' + (this.responseText || '').substring(0, 2000));
        post('UBER_API_DISCOVERY', this.responseText || '', reqUrl);
      }
    });

    return origSend.apply(this, arguments);
  };

  // --- Auto-fetch ---
  function triggerAutoFetch() {
    if (autoFetchStarted) return;
    autoFetchStarted = true;
    postProgress('starting', { message: 'Connecting to your account...' });
    setTimeout(function() { autoFetchTrips(); }, 500);
  }

  async function fetchFeedWeek(startDate, endDate, allTrips, allBonuses) {
    var body = JSON.stringify({
      startDateIso: fmtDate(startDate),
      endDateIso: fmtDate(endDate),
      paginationOption: {},
    });

    var hasMore = true;
    var paginationOption = {};
    var pageNum = 0;

    while (hasMore) {
      pageNum++;
      var reqBody = pageNum === 1
        ? body
        : JSON.stringify({ startDateIso: fmtDate(startDate), endDateIso: fmtDate(endDate), paginationOption: paginationOption });

      try {
        var res = await originalFetch(FEED_PATH + '?localeCode=en', {
          method: 'POST',
          headers: Object.assign({}, capturedHeaders, { 'content-type': 'application/json' }),
          body: reqBody,
          credentials: 'include',
        });

        if (!res.ok) break;

        var text = await res.text();
        var parsed = JSON.parse(text);

        if (parsed.status !== 'success') break;

        var activities = (parsed.data && parsed.data.activities) || [];

        for (var a = 0; a < activities.length; a++) {
          var act = activities[a];
          if (!act.uuid) continue;
          if (act.type === 'TRIP') {
            allTrips.push(act);
          } else {
            allBonuses.push(act);
          }
        }

        post('UBER_ACTIVITY_FEED_CAPTURED', text, FEED_PATH);

        if (parsed.data && parsed.data.paginationOption && parsed.data.paginationOption.hasMore) {
          paginationOption = parsed.data.paginationOption;
          await sleep(DELAY_BETWEEN_WEEKS_MS);
        } else {
          hasMore = false;
        }
      } catch (e) {
        hasMore = false;
      }
    }
  }

  async function autoFetchTrips() {
    if (!capturedHeaders) return;

    console.log('[DriversReward] Auto-fetching last ' + WEEKS_TO_FETCH + ' weeks of trips...');
    postProgress('fetching_history', { message: 'Scanning your trip history...', week: 0, totalWeeks: WEEKS_TO_FETCH });

    var allTrips = [];
    var allBonuses = [];

    for (var w = 0; w < WEEKS_TO_FETCH; w++) {
      var endDate = new Date();
      endDate.setDate(endDate.getDate() - w * 7);
      var startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 7);

      var endPlusOne = new Date(endDate);
      endPlusOne.setDate(endPlusOne.getDate() + 1);

      postProgress('fetching_history', {
        message: 'Scanning your trip history...',
        week: w + 1,
        totalWeeks: WEEKS_TO_FETCH,
      });

      console.log('[DriversReward] Week ' + (w + 1) + ': ' + fmtDate(startDate) + ' \u2192 ' + fmtDate(endPlusOne));
      await fetchFeedWeek(startDate, endPlusOne, allTrips, allBonuses);
      await sleep(DELAY_BETWEEN_WEEKS_MS);
    }

    // Deduplicate trips
    var seen = {};
    var uniqueTrips = allTrips.filter(function(t) {
      if (seen[t.uuid]) return false;
      seen[t.uuid] = true;
      return true;
    });

    // Deduplicate bonuses
    var seenBonuses = {};
    var uniqueBonuses = allBonuses.filter(function(b) {
      if (seenBonuses[b.uuid]) return false;
      seenBonuses[b.uuid] = true;
      return true;
    });

    if (uniqueBonuses.length > 0) {
      console.log('[DriversReward] Found ' + uniqueBonuses.length + ' bonus/quest activities — fetching details...');
      for (var b = 0; b < uniqueBonuses.length; b++) {
        var bonus = uniqueBonuses[b];
        try {
          var detailBody = { eventType: bonus.type || 'MISC', activityFeedUUID: bonus.uuid };
          var routing = bonus.routing || {};
          var webUrl = routing.webviewUrl || '';
          var incentiveMatch = webUrl.match(/incentiveUUID=([^&]+)/);
          if (incentiveMatch) detailBody.incentiveUUID = incentiveMatch[1];
          var tsMatch = webUrl.match(/timestamp=(\d+)/);
          if (tsMatch) detailBody.timestamp = parseInt(tsMatch[1]);

          var detailRes = await originalFetch('/earnings/api/getActivityDetail?localeCode=en', {
            method: 'POST',
            headers: Object.assign({}, capturedHeaders, { 'content-type': 'application/json' }),
            body: JSON.stringify(detailBody),
            credentials: 'include',
          });
          if (detailRes.ok) {
            var detailJson = await detailRes.json();
            if (detailJson.status === 'success' && detailJson.data && detailJson.data.items) {
              var items = detailJson.data.items;
              for (var di = 0; di < items.length; di++) {
                var item = items[di];
                if (item.bodyHeaderMetadata) {
                  bonus._detailFormattedDate = item.bodyHeaderMetadata.formattedDate || '';
                  bonus._detailLabel = item.bodyHeaderMetadata.label || '';
                }
                if (item.sectionSubHeaderMetadata && item.sectionSubHeaderMetadata.text) {
                  bonus._detailDescription = item.sectionSubHeaderMetadata.text;
                }
              }
              console.log('[DriversReward] Bonus detail: ' + (bonus._detailDescription || '(no description)'));
            }
          }
          if (b < uniqueBonuses.length - 1) await sleep(200);
        } catch (e) {
          console.log('[DriversReward] Bonus detail fetch failed: ' + e.message);
        }
      }
      post('UBER_BONUSES_CAPTURED', JSON.stringify(uniqueBonuses), '');
    }

    var totalItems = uniqueTrips.length + uniqueBonuses.length;
    console.log('[DriversReward] Found ' + uniqueTrips.length + ' trips + ' + uniqueBonuses.length + ' bonuses — fetching trip details...');
    postProgress('fetching_details', {
      message: 'Calculating your rewards...',
      fetched: 0,
      total: uniqueTrips.length,
    });

    var fetched = 0;
    for (var i = 0; i < uniqueTrips.length; i += PARALLEL_TRIP_FETCH) {
      var batch = uniqueTrips.slice(i, i + PARALLEL_TRIP_FETCH);
      var promises = batch.map(function(trip) {
        return originalFetch(TRIP_PATH + '?localeCode=en', {
          method: 'POST',
          headers: Object.assign({}, capturedHeaders, { 'content-type': 'application/json' }),
          body: JSON.stringify({ tripUUID: trip.uuid }),
          credentials: 'include',
        }).then(function(res) {
          if (res.ok) {
            return res.text().then(function(text) {
              post('UBER_TRIP_CAPTURED', text, TRIP_PATH + '?uuid=' + trip.uuid);
              return true;
            });
          }
          return false;
        }).catch(function() { return false; });
      });
      var results = await Promise.all(promises);
      fetched += results.filter(Boolean).length;

      postProgress('fetching_details', {
        message: 'Calculating your rewards...',
        fetched: fetched,
        total: uniqueTrips.length,
      });

      if (i + PARALLEL_TRIP_FETCH < uniqueTrips.length) await sleep(DELAY_BETWEEN_TRIPS_MS);
    }

    console.log('[DriversReward] Complete: ' + fetched + '/' + uniqueTrips.length + ' trips captured, ' + uniqueBonuses.length + ' bonuses');
    postProgress('submitting', { message: 'Finalizing your point balance...', fetched: fetched, total: uniqueTrips.length });
    await sleep(300);
    postProgress('complete', { message: 'Your reward points are up to date', fetched: fetched, total: totalItems });
    post('AUTO_FETCH_COMPLETE', JSON.stringify({ total: uniqueTrips.length, fetched: fetched, bonuses: uniqueBonuses.length }), '');
  }

  function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }
})();
