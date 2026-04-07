# DriversReward

**[driversreward.com](https://driversreward.com)**

A reward programme for ride-hailing drivers in **Hong Kong** and **Brazil** to earn points by sharing trip earnings data, redeemable for gift cards.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│  Chrome Extension    │     │  Android Gateway App  │
│  (Manifest V3)       │     │  (Kotlin + Compose)   │
│                      │     │                       │
│  Intercepts Uber     │     │  WebView loads Uber   │
│  driver portal API   │     │  driver portal, JS    │
│  responses via       │     │  bridge intercepts    │
│  content script      │     │  API responses        │
└──────────┬───────────┘     └──────────┬────────────┘
           │                            │
           │  POST /api/ingest/trips    │
           └──────────┬─────────────────┘
                      ▼
         ┌────────────────────────┐
         │    Backend API          │
         │    (Node.js/TypeScript) │
         │                        │
         │  ├─ Auth (JWT + bcrypt)│
         │  ├─ Ingestion          │
         │  ├─ Points Engine      │
         │  ├─ Redemption         │
         │  └─ Compliance (GDPR)  │
         └──────────┬─────────────┘
                    │
          ┌─────────┼──────────┐
          ▼         ▼          ▼
     PostgreSQL   Redis    BullMQ
     (data)      (cache)   (jobs)
```

## Components

| Component | Tech Stack | Purpose |
|-----------|-----------|---------|
| **Backend API** | Node.js, TypeScript, Express, Prisma, BullMQ | Auth, data ingestion, points engine, gift card redemption |
| **Chrome Extension** | Manifest V3, vanilla JS | Intercepts Uber driver portal API responses in browser |
| **Android App** | Kotlin, Jetpack Compose, Hilt, WebView | Gateway app with Uber portal WebView + API interception |
| **Database** | PostgreSQL 16 | Drivers, trips, points ledger, redemptions, audit logs |
| **Cache/Queue** | Redis 7 + BullMQ | Rate limiting, job queue (data purge, gift card fulfillment) |

## Quick Start

```bash
# Clone and start infrastructure
cd driversreward
docker compose up -d

# Run database migrations
docker compose run --rm migrate

# Or develop locally
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

## API Endpoints

### Auth
- `POST /api/auth/register` — Register new driver
- `POST /api/auth/login` — Login
- `POST /api/auth/refresh` — Refresh access token

### Data Ingestion (requires auth)
- `POST /api/ingest/trips` — Submit batch of trip data
- `POST /api/ingest/activity-feed` — Submit activity feed for dedup

### Rewards (requires auth)
- `GET /api/rewards/balance` — Get points balance
- `GET /api/rewards/history` — Points ledger history
- `GET /api/rewards/gift-cards` — Available gift cards for driver's region
- `POST /api/rewards/redeem` — Redeem a gift card
- `GET /api/rewards/redemptions` — Redemption history

### Driver Profile (requires auth)
- `GET /api/driver/me` — Driver profile
- `GET /api/driver/trips` — Trip history
- `GET /api/driver/stats` — Earnings statistics

### Health
- `GET /health` — System health check
- `GET /ready` — Readiness probe

## Data Flow

1. Driver logs into Uber's driver portal at `drivers.uber.com`
2. Chrome Extension / Android App intercepts API responses:
   - `POST /earnings/api/getWebActivityFeed` → trip UUIDs
   - `POST /earnings/api/getTrip` → full trip breakdown
3. Captured data is sent to our backend (deduplicated by trip UUID)
4. Points engine calculates reward points per trip
5. Driver accumulates points and redeems for gift cards

## Security

- **No Uber credentials stored** — drivers use their own browser session
- **AES-256-GCM** encryption for PII (name, email, phone)
- **JWT** with 15-minute access tokens + refresh token rotation
- **Payload integrity** — SHA-256 hash of raw Uber response prevents tampering
- **Velocity checks** — max 50 trip submissions per hour
- **Fare plausibility** — rejects trips with implausible amounts
- See [Threat Model](docs/security/THREAT-MODEL.md)

## Compliance

- **Hong Kong PDPO** — 6 Data Protection Principles implemented
- **Brazil LGPD** — Consent-based, data subject rights, DPO designated
- **Data retention** — Raw payloads purged after 30 days, IP addresses after 90 days
- **Points expiry** — 365-day expiry from earn date
- See [Data Privacy](docs/compliance/DATA-PRIVACY.md)

## Agency Agents Applied

This project was architected using specialized agents from [agency-agents](https://github.com/msitarzewski/agency-agents):

| Agent | Contribution |
|-------|-------------|
| Software Architect | System design, bounded contexts, ADRs |
| Backend Architect | API design, database schema, Express architecture |
| Security Engineer | Threat model, encryption, payload integrity, rate limiting |
| Mobile App Builder | Android Gateway App (Kotlin/Compose/WebView) |
| DevOps Automator | Docker, docker-compose, CI/CD pipeline |
| Database Optimizer | Prisma schema, indexes, query patterns |
| Legal Compliance Checker | PDPO + LGPD compliance, data retention, consent management |
