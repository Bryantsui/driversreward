// Runs in ISOLATED world — bridges postMessage from the MAIN world interceptor
// to the extension's background service worker via chrome.runtime.sendMessage.

(function () {
  'use strict';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'driversreward-interceptor') return;

    const { type, body, url } = event.data;

    if (type === 'UBER_TRIP_CAPTURED' || type === 'UBER_ACTIVITY_FEED_CAPTURED') {
      chrome.runtime.sendMessage({ type, rawBody: body, url });
    } else if (type === 'UBER_LOGIN_STATE' || type === 'PROGRESS_UPDATE' || type === 'AUTO_FETCH_COMPLETE') {
      chrome.runtime.sendMessage({ type, rawBody: body, url });
    }
  });
})();
