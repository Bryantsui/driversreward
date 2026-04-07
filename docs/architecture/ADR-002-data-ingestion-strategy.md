# ADR-002: Data Ingestion Strategy — Client-Side API Interception

## Status
Accepted

## Context
Drivers log in to Uber's driver portal (drivers.uber.com) in their own browser or our
Android WebView. We need to capture trip and earnings data from two Uber endpoints:

1. `POST /earnings/api/getWebActivityFeed` — returns trip UUIDs and summary data
2. `POST /earnings/api/getTrip` — returns full trip breakdown by UUID

We do NOT ask drivers for their Uber credentials. The driver is already authenticated
in their own browser session.

## Decision
Both the Chrome Extension and Android App intercept HTTP responses from the Uber
driver portal and forward the response payloads to our backend.

### Chrome Extension
- Uses `chrome.webRequest.onCompleted` + `chrome.devtools.network` or 
  `chrome.scripting` to intercept fetch/XHR responses from the target endpoints
- Content script injects a response interceptor on `drivers.uber.com`
- Captured payloads are sent to our backend via authenticated POST

### Android Gateway App
- WebView loads `drivers.uber.com`
- `WebViewClient.shouldInterceptRequest()` + JavaScript interface bridges
  capture API responses
- Payloads forwarded to our backend

### Deduplication
- Trip UUID is the natural idempotency key
- Backend upserts on (driver_id, trip_uuid) — duplicate submissions are safe
- Activity feed submissions are diffed against known trip UUIDs

## Consequences
**Easier**: No Uber credentials needed, drivers control their own session, simple privacy model
**Harder**: Uber can change API shape/paths requiring extension updates; response interception
requires careful handling of Content-Security-Policy on the Uber portal
