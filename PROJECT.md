# DriversReward — Project Documentation

**Domain:** [driversreward.com](https://driversreward.com) | **API:** [api.driversreward.com](https://api.driversreward.com) | **GitHub:** [Bryantsui/driversreward](https://github.com/Bryantsui/driversreward)

---

## 1. What Is DriversReward?

DriversReward is a loyalty programme for ride-hailing drivers (currently Uber) in **Hong Kong** and **Brazil**. Drivers earn reward points by sharing their trip earnings data, which they can redeem for digital gift cards.

### How It Works (Driver's Perspective)

1. Driver installs the **Chrome Extension** or **Android App**.
2. Signs up for a free DriversReward account.
3. Logs into the Uber Driver portal (`drivers.uber.com`) through our extension/app.
4. The system automatically intercepts Uber's internal API responses to capture trip data.
5. **1 point** is awarded per completed trip synced within the weekly earning window.
6. Points are redeemable for digital gift cards (supermarkets, petrol, restaurants, etc.).

### Weekly Earning Window

Drivers can sync anytime, but points are only awarded for trips synced within a **72-hour window** each week:

- **Monday 00:00:00 → Wednesday 23:59:59** (driver's local timezone: HKT or BRT)
- Outside this window, syncing still works but awards 0 points.
- The UI shows a countdown to the next earning window.

---

## 2. Architecture Overview

```
┌─────────────────────────┐        ┌──────────────────────────┐
│   Chrome Extension       │        │   Android App             │
│   (Manifest V3)          │        │   (Kotlin + Compose)      │
│                          │        │                           │
│   Content scripts inject │        │   WebView loads Uber      │
│   into drivers.uber.com  │        │   portal; JS bridge       │
│   and intercept fetch    │        │   intercepts API calls    │
└────────────┬─────────────┘        └────────────┬──────────────┘
             │                                   │
             │     POST /api/ingest/trips        │
             └─────────────┬─────────────────────┘
                           ▼
            ┌─────────────────────────────┐
            │     Backend API              │
            │     (Node.js / TypeScript)   │
            │                              │
            │  Express 4 + Prisma ORM      │
            │  JWT Auth + AES-256 Encrypt  │
            │  BullMQ workers (Redis)      │
            │  Server-side scraper (opt.)  │
            └──────────────┬───────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         PostgreSQL     Redis       Caddy
         16-alpine    7-alpine    (reverse proxy
          (data)     (cache/queue)  + TLS)
```

### Component Summary

| Component | Tech Stack | Location |
|-----------|-----------|----------|
| **Backend API** | Node.js 22, TypeScript, Express 4, Prisma 6, BullMQ | `backend/` |
| **Chrome Extension** | Manifest V3, vanilla JS, Service Worker | `chrome-extension/` |
| **Android App** | Kotlin, Jetpack Compose, Hilt, WebView, Retrofit | `android-app/` |
| **Admin Dashboard** | Single-page HTML/JS served by backend | `backend/src/admin-ui/dashboard.html` |
| **Landing Page** | Static HTML | `landing-page/` |
| **Infrastructure** | Docker Compose, Caddy, GitHub Actions CI | `infrastructure/`, `.github/` |

---

## 3. Repository Structure

```
driversreward/
├── backend/                    # Node.js API server
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema (14 models)
│   │   ├── seed.ts             # Seed data (admin user, gift cards)
│   │   └── migrations/         # Prisma migration history
│   ├── src/
│   │   ├── server.ts           # Express app entry point
│   │   ├── config/             # env.ts, logger.ts, database.ts, redis.ts
│   │   ├── api/
│   │   │   ├── routes/         # auth, ingestion, rewards, driver, admin, session, health
│   │   │   ├── middleware/     # JWT auth, admin auth, error handler
│   │   │   └── validators/    # Zod request validation
│   │   ├── services/           # Business logic (auth, ingestion, points, redemption, admin, uber-scraper)
│   │   ├── jobs/               # Cron jobs (scrape-scheduler, data-purge)
│   │   ├── workers/            # BullMQ workers (scrape-worker)
│   │   ├── utils/              # JWT, encryption, sync-window helpers
│   │   └── admin-ui/           # Single-page admin dashboard HTML
│   ├── tests/                  # Vitest test suite
│   ├── .env.example            # Environment variable template
│   └── package.json
│
├── chrome-extension/           # Chrome MV3 Extension
│   ├── manifest.json
│   ├── src/
│   │   ├── background/         # service-worker.js, session-keeper.js
│   │   ├── content/            # interceptor-main.js (MAIN world), interceptor.js
│   │   └── popup/              # popup.html, popup.js
│   └── public/icons/           # Extension icons (16/48/128px)
│
├── android-app/                # Android Gateway App
│   ├── app/
│   │   ├── build.gradle.kts    # App config (versionCode=13, targetSdk=35)
│   │   ├── proguard-rules.pro  # R8/ProGuard rules
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       └── java/com/driversreward/app/
│   │           ├── ui/screens/  # Login, Register, Dashboard, WebView, ForgotPassword
│   │           ├── data/        # API interfaces (Retrofit), repositories
│   │           ├── di/          # Hilt dependency injection
│   │           └── util/        # SessionKeeper
│   └── keystore.properties     # (gitignored) signing config
│
├── landing-page/               # Static site served at driversreward.com
│   ├── index.html
│   └── privacy.html
│
├── infrastructure/
│   ├── docker/
│   │   └── Dockerfile.backend  # Multi-stage Node 22 image
│   └── caddy/
│       └── Caddyfile           # Reverse proxy + static file serving
│
├── docs/
│   ├── security/THREAT-MODEL.md
│   └── compliance/DATA-PRIVACY.md
│
├── .github/workflows/ci.yml   # CI pipeline (lint, test, security scan, Docker build)
├── docker-compose.yml          # Local development
├── docker-compose.prod.yml     # Production deployment
├── upload_to_play.py           # Script to push AAB to Google Play via API
└── play-service-account.json   # (gitignored) Google Play service account key
```

---

## 4. Database Schema

PostgreSQL 16 via Prisma ORM. Key models:

| Model | Purpose |
|-------|---------|
| `Driver` | User accounts (phone as primary login, optional email, encrypted name, password, region HK/BR, points balance, referral code) |
| `Trip` | Captured Uber trips (trip UUID, fare breakdown, coordinates, payload hash, points awarded, admin review status) |
| `ActivitySync` | Records of each sync session (driver, date range, trip count, source) |
| `PointLedger` | Immutable point transaction log (trip_earn, redemption, adjustment, expiry) |
| `GiftCard` | Reward catalog (name, region, points cost, face value, stock, active flag) |
| `Redemption` | Gift card redemption requests (status lifecycle: PENDING → PROCESSING → FULFILLED/FAILED/CANCELLED) |
| `RefreshToken` | JWT refresh tokens with rotation tracking |
| `Consent` | GDPR/LGPD consent records (data collection, marketing, sharing) |
| `AuditLog` | Administrative action log |
| `Admin` | Admin users (SUPER_ADMIN, REVIEWER, VIEWER roles) |
| `UberSession` | Active Uber portal sessions (heartbeat tracking) |
| `UberCredential` | Encrypted Uber session cookies/CSRF for server-side scraping |
| `ScrapeJob` | Server-side scrape job tracking (status, trips found, proxy IP) |

### Key Indexes

- `uq_driver_trip` — unique constraint on `(driverId, tripUuid)` prevents duplicate trip submissions per driver
- `idx_trip_uuid` — cross-driver dedup lookup (same trip UUID from different accounts is flagged)
- `idx_trip_purge` — efficient raw payload cleanup after 30-day retention

### Cross-Driver Deduplication

A trip UUID can only earn points for **one** DriversReward account. If a second account submits the same trip UUID, it is stored but awarded 0 points. This prevents fraud where multiple accounts claim the same driver's trips.

---

## 5. Backend API

### Tech Stack

- **Runtime:** Node.js 22, TypeScript
- **Framework:** Express 4
- **ORM:** Prisma 6
- **Queue:** BullMQ (Redis-backed)
- **Auth:** JWT (access: 15m, refresh: 7d), bcrypt password hashing
- **Encryption:** AES-256-GCM for PII fields (name, credentials)
- **Validation:** Zod schemas

### API Routes

| Route Group | Endpoints | Auth |
|-------------|-----------|------|
| **Auth** (`/api/auth`) | `POST /register`, `/login`, `/refresh`, `/forgot-password`, `/reset-password` | Public |
| **Ingestion** (`/api/ingest`) | `POST /trips`, `/raw-trips`, `/activity-feed` | Driver JWT |
| **Rewards** (`/api/rewards`) | `GET /balance`, `/history`, `/gift-cards`, `/redemptions`; `POST /redeem` | Driver JWT |
| **Driver** (`/api/driver`) | `GET /me`, `/trips`, `/stats` | Driver JWT |
| **Session** (`/api/session`) | Heartbeat, end session, credential store/revoke, trigger scrape | Driver JWT |
| **Admin** (`/api/admin`) | Login, dashboard data, driver management, trip review, gift card CRUD, redemption fulfill/cancel, CSV export, scrape job monitoring | Admin JWT |
| **Health** (`/`) | `GET /health`, `GET /ready` | Public |

### Background Workers

| Worker | Schedule | Purpose |
|--------|----------|---------|
| **Scrape Scheduler** | Cron (configurable) | Queues server-side scrape jobs for drivers with valid credentials |
| **Scrape Worker** | BullMQ consumer | Executes Uber API scraping via rotating proxies, circuit breaker per region |
| **Data Purge** | Daily | Deletes raw payloads older than 30 days, expired tokens, old audit logs |

### Rate Limiting

- Global: 100 requests per 15 minutes on `/api`
- Auth endpoints: stricter limits to prevent brute force
- Manual scrape trigger: 24-hour cooldown per driver

---

## 6. Chrome Extension

### Manifest V3

- **Permissions:** `storage`, `activeTab`, `cookies`, `notifications`, `alarms`, `tabs`
- **Host permissions:** `https://drivers.uber.com/*`, `https://*.uber.com/*`, `https://api.driversreward.com/*`

### How Data Capture Works

1. **`interceptor-main.js`** (MAIN world content script) — Monkey-patches `window.fetch` on `drivers.uber.com` to intercept Uber's internal API responses:
   - `POST /earnings/api/getWebActivityFeed` → extracts trip UUIDs
   - `POST /earnings/api/getTrip` → extracts full trip breakdown (fare, route, duration, etc.)
2. **`interceptor.js`** — Relays intercepted data from the page context to the extension's service worker via `window.postMessage`.
3. **`service-worker.js`** — Receives trip data, batches it, and sends to backend via `POST /api/ingest/trips`. Also captures Uber session cookies and CSRF tokens for optional server-side scraping.
4. **`popup.html/popup.js`** — Extension popup showing: account status, points balance, sync progress, earning window countdown, redemption history, "How Points Work" section.

### Invisible Token Capture

Session cookies and CSRF tokens are captured silently in the background and sent to the backend for server-side scraping. The UI does not expose any token/cookie capture to the driver.

---

## 7. Android App

### Technical Details

| Property | Value |
|----------|-------|
| **Package** | `com.driversreward.app` |
| **Min SDK** | 26 (Android 8.0) |
| **Target SDK** | 35 (Android 15) |
| **Version** | 1.4.0 (versionCode 13) |
| **Language** | Kotlin |
| **UI** | Jetpack Compose + Material 3 (light theme) |
| **DI** | Hilt |
| **HTTP** | Retrofit + OkHttp |
| **Storage** | DataStore Preferences |

### Screens

| Screen | Route | Description |
|--------|-------|-------------|
| **Login** | `login` | Phone number + country code login (+852 HK, +55 BR) |
| **Register** | `register` | Name, phone (required), email (optional), password, region |
| **Forgot Password** | `forgot-password` | Phone-based password reset flow |
| **Dashboard** | `dashboard` | Three tabs: Home, Rewards, Profile |
| **WebView** | `webview` | Uber portal with animated sync overlay, captcha detection |

### Key Features

- **Full-screen animated sync overlay** — Native Android Dialog covers WebView during sync with animated step timeline (Scanning Trips → Calculating Rewards → Finalizing Balance)
- **Captcha/challenge detection** — Overlay auto-pauses if Uber triggers captcha, reveals WebView for user verification, then resumes
- **Cancel button with confirmation** — "Interrupting may result in incomplete point calculation" warning
- **Auto-navigate home on completion** — Returns to dashboard after sync
- **Phone-based authentication** — Login/register/forgot-password all use phone number with country code
- **Same interception logic as extension** — Shares `interceptor-main.js` (copied into assets at build time)
- **WebView JS Bridge** — `PostMessageBridge` uses `org.json.JSONObject` (immune to R8 obfuscation)
- **WebView URL allowlist** — Navigation restricted to `*.uber.com` / `*.uber.org` only
- **Collapsible monthly earnings** — Scrollable breakdown by month
- **Earning window countdown** — "Earn Points Now" during active window, or countdown (DD HH MM) to next
- **Profile tab** — Name, phone, email, referral code (copy/share), "How Points Work" section
- **Redemption system** — Browse gift cards, redeem points, view history with status tracking
- **Weekly push notifications** — WorkManager notification every Monday when earning window opens
- **R8/ProGuard enabled** for release builds with comprehensive keep rules
- **WebView properly destroyed** on screen exit (prevents memory leaks)
- **WebView debugging disabled** in release builds (`BuildConfig.DEBUG` gated)

### Build & Release

```bash
cd android-app
./gradlew bundleRelease   # produces app-release.aab
```

Release signing uses `driversreward-upload.jks` keystore (passwords in `keystore.properties`, gitignored).

Upload to Google Play Internal Testing:
```bash
python3 upload_to_play.py   # uses play-service-account.json
```

---

## 8. Admin Dashboard

Single-page HTML app served at `https://api.driversreward.com/admin`.

### Features

| Tab | Capabilities |
|-----|-------------|
| **Overview** | Total drivers, trips, points, active sessions |
| **Drivers** | List, search, view details, reset passwords |
| **Trips** | Browse all trips, filter by driver/region/date, review/approve/flag, export CSV |
| **Redemptions** | View pending requests, fulfill with gift card code, cancel |
| **Gift Cards** | CRUD catalog (add/edit/deactivate/restock) |
| **Sessions** | Active Uber sessions per driver |
| **Scrape Jobs** | Server-side scrape job monitoring (status, trips found, errors) |
| **Point Ledger** | Full transaction audit trail |

### Auth

- Separate admin JWT (independent secret from driver auth)
- Admin roles: `SUPER_ADMIN`, `REVIEWER`, `VIEWER`

---

## 9. Infrastructure & Deployment

### Production Server

- **Provider:** Hetzner Cloud (CAX11 ARM64)
- **IP:** 204.168.253.215
- **OS:** Ubuntu

### Docker Services (Production)

| Service | Image | Purpose |
|---------|-------|---------|
| `api` | Custom (Node 22 multi-stage) | Backend API on port 3000 |
| `postgres` | `postgres:16-alpine` | Primary database |
| `redis` | `redis:7-alpine` (256MB, noeviction) | Cache, BullMQ queue |
| `caddy` | `caddy:2-alpine` | Reverse proxy, auto TLS (Let's Encrypt) |

### DNS Records

| Record | Type | Value |
|--------|------|-------|
| `@` | A | 204.168.253.215 |
| `www` | A | 204.168.253.215 |
| `api` | A | 204.168.253.215 |

### Caddy Routing

- `api.driversreward.com` → reverse proxy to `api:3000`
- `driversreward.com` / `www.driversreward.com` → static landing page

### Deploying Updates

```bash
ssh root@204.168.253.215
cd /opt/driversreward
git pull origin main
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d
```

---

## 10. CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`), triggers on push/PR to `main`.

| Job | What It Does |
|-----|-------------|
| **lint-and-typecheck** | `npm ci`, `prisma generate`, TypeScript typecheck, ESLint |
| **test** | Spins up Postgres + Redis services, runs Prisma migrations, executes Vitest suite |
| **security-scan** | Trivy filesystem vulnerability scan (CRITICAL/HIGH severity, fails on findings) |
| **secrets-scan** | Gitleaks scans commit history for leaked secrets |
| **build-docker** | (main branch only) Builds Docker image, runs health check smoke test |

---

## 11. Environment Variables

Copy `backend/.env.example` and fill in production values:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_ACCESS_SECRET` | Yes | Secret for driver access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | Yes | Secret for driver refresh tokens (min 32 chars) |
| `JWT_ADMIN_SECRET` | Yes | **Independent** secret for admin tokens (min 32 chars) |
| `ENCRYPTION_KEY` | Yes | 64-char hex string (32 bytes) for AES-256-GCM |
| `PORT` | No | API port (default: 3000) |
| `NODE_ENV` | No | `development` / `production` / `test` |
| `ALLOWED_ORIGINS` | Yes | Comma-separated CORS origins |
| `PROXY_HK_URL` | No | Residential proxy URL for HK server-side scraping |
| `PROXY_BR_URL` | No | Residential proxy URL for BR server-side scraping |
| `SCRAPE_ENABLED` | No | `true`/`false` (default: false) |
| `SCRAPE_CONCURRENCY` | No | Max concurrent scrape jobs (default: 2) |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` |

Generate secrets:
```bash
openssl rand -base64 64 | tr -d '\n'   # for JWT secrets
openssl rand -hex 32                     # for ENCRYPTION_KEY
```

---

## 12. Security & Compliance

### Security Measures

- **No Uber credentials stored by drivers** — drivers use their own browser session; we only read trip data
- **AES-256-GCM** encryption for all PII (name, Uber session cookies, CSRF tokens, gift card codes)
- **JWT authentication** with 15-minute access tokens + refresh token rotation
- **Independent admin JWT secret** — compromising driver tokens cannot access admin
- **Payload integrity** — SHA-256 hash of raw Uber response prevents client-side tampering
- **Rate limiting** — global + per-endpoint limits
- **Fare plausibility checks** — rejects trips with implausible amounts
- **Cross-driver deduplication** — same trip UUID only earns points for one account
- **R8/ProGuard** in Android release builds with comprehensive keep rules
- **WebView URL allowlist** — navigation restricted to `*.uber.com` / `*.uber.org` domains
- **Bridge logging gated** behind `BuildConfig.DEBUG` — no sensitive data in release logs
- **WebView properly destroyed** on screen exit (prevents memory/session leaks)
- **WebView debugging disabled** in release builds
- **Cryptographically secure** reset codes (`crypto.randomInt`)
- **Data purge worker** — raw payloads deleted after 30 days

### Compliance

- **Hong Kong PDPO** — 6 Data Protection Principles implemented
- **Brazil LGPD** — Consent-based data collection, data subject rights, DPO designated
- **Data retention** — Raw payloads purged after 30 days, IP addresses after 90 days
- **Points expiry** — 365 days from earn date
- **Privacy policy** — Published at [driversreward.com/privacy.html](https://driversreward.com/privacy.html)

---

## 13. Server-Side Scraping (Optional)

An optional server-side scraping system that can fetch trip data on behalf of drivers without requiring them to be online.

### How It Works

1. When a driver logs into Uber via the extension/app, session cookies (`sid`, `csid`, `smeta`) and CSRF token are silently captured and encrypted on the backend.
2. A cron scheduler periodically queues scrape jobs for drivers with valid credentials.
3. The scrape worker executes Uber API calls through **rotating residential proxies** (configurable per region: HK, BR).
4. Fetched trip data goes through the same ingestion pipeline as client-side submissions.
5. A Redis-backed circuit breaker pauses scraping for a region if failures exceed a threshold.

### Session Cookie Validity

| Cookie | Domain | Validity | Notes |
|--------|--------|----------|-------|
| `sid` | `.uber.com` | ~6 months | Primary session token, HttpOnly |
| `csid` | `.auth.uber.com` | ~6 months | Auth session, HttpOnly |
| `smeta` | `.uber.com` | ~6 months | Session metadata |
| `jwt-session` | `drivers.uber.com` | ~24 hours | Auto-refreshes with valid `sid` |

Drivers only need to re-authenticate every ~6 months or when Uber invalidates their session.

---

## 14. Points System

| Rule | Value |
|------|-------|
| Points per completed trip | 1 |
| Earning window | Monday 00:00 → Wednesday 23:59:59 (local TZ) |
| Points for sync outside window | 0 (trip is still stored) |
| Points expiry | 365 days from earn date |
| Minimum redemption | Varies by gift card (e.g., 5 points) |
| Cross-account dedup | Same trip UUID = 0 points for second account |

---

## 15. Getting Started (Local Development)

### Prerequisites

- Node.js 22+
- Docker & Docker Compose
- Android Studio (for app development)
- Chrome (for extension development)

### Backend

```bash
cd backend
cp .env.example .env          # edit with your values
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed            # creates admin user + sample gift cards
npm run dev                   # starts on http://localhost:3000
```

Or with Docker:
```bash
docker compose up -d          # starts postgres + redis + api
docker compose run --rm migrate
```

### Chrome Extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `chrome-extension/` folder
4. Navigate to `https://drivers.uber.com`

### Android App

1. Open `android-app/` in Android Studio
2. Sync Gradle
3. For debug builds (hits local or production API based on `BuildConfig.API_BASE_URL`):
   ```bash
   cd android-app && ./gradlew installDebug
   ```
4. For release AAB:
   ```bash
   ./gradlew bundleRelease
   ```

### Admin Dashboard

Navigate to `http://localhost:3000/admin` (or `https://api.driversreward.com/admin` in production).

Default admin credentials are created by the seed script.

---

## 16. Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **Manifest V3 over V2** | Chrome Web Store requirement; future-proof |
| **WebView in Android (not native Uber SDK)** | No official Uber earnings SDK exists; WebView reuses exact same JS interception logic |
| **Shared `interceptor-main.js`** | Single source of truth for API interception, copied into Android assets at build |
| **BullMQ over simple cron** | Reliable job processing with retries, concurrency control, dead-letter queue |
| **Prisma over raw SQL** | Type-safe queries, migration management, schema-as-code |
| **Caddy over Nginx** | Automatic HTTPS (Let's Encrypt), zero-config TLS renewal |
| **Weekly earning window** | Encourages regular engagement while keeping server load predictable |
| **Regional proxies** | Prevents Uber from flagging a single IP for all scrape traffic |
| **AES-256-GCM not at-rest DB encryption** | Application-level encryption gives fine-grained control over which fields are encrypted |

---

## 17. Distribution

| Platform | Status | Details |
|----------|--------|---------|
| **Chrome Web Store** | Submitted for review | Extension ID pending approval |
| **Google Play (Internal Testing)** | v1.4.0 (code 13) | Package: `com.driversreward.app` |
| **APK Sideload** | Available | Debug APK can be shared directly |
| **Web (Landing)** | Live | [driversreward.com](https://driversreward.com) |
| **API** | Live | [api.driversreward.com](https://api.driversreward.com) |

---

## 18. Known Limitations & Next Steps

### Current Limitations

- Admin dashboard uses inline HTML (XSS risk in fare breakdown display — admin-only access mitigates risk)
- Server-side scraping requires residential proxy subscription (not yet configured in production)
- Gift card fulfillment is manual (admin enters codes after purchase)
- No phone number verification flow (phone is collected but not verified via SMS OTP)
- Chrome extension pending Web Store approval
- Uber session cookies sent to backend for server-side scraping (treat as crown-jewel secrets)

### Potential Next Steps

- SMS OTP verification for phone-based registration
- Automated gift card procurement via provider API
- Driver referral bonus system
- Multi-platform support (Grab, Bolt, 99, etc.)
- Admin dashboard migration to React/Next.js (from single HTML file)
- App Store (iOS) version
- Automated Uber login flow (OTP relay) for server-side scraping
