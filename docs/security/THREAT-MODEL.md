# Threat Model: DriversBonus (driversbonus.com)

**Date**: 2026-04-07 | **Version**: 1.0 | **Author**: Security Engineer Agent

## System Overview
- **Architecture**: Modular monolith (Node.js/TypeScript)
- **Tech Stack**: TypeScript, Express, PostgreSQL, Redis, BullMQ
- **Data Classification**: PII (driver name, email, phone), Financial (trip earnings, fare breakdowns)
- **Deployment**: Docker on AWS ECS / DigitalOcean App Platform
- **External Integrations**: Gift card providers, email/SMS verification, Uber driver portal (read-only)
- **Regions**: Hong Kong (PDPO), Brazil (LGPD)

## Trust Boundaries

| Boundary | From | To | Controls |
|----------|------|----|----------|
| Internet → API | Chrome Ext / Android App | API Gateway | TLS 1.3, rate limiting, JWT auth |
| Client → Uber Portal | Driver's browser | drivers.uber.com | Driver's own session (we never see credentials) |
| Extension → Backend | Chrome Ext / Android | Our API | JWT bearer token, request signing |
| API → Database | Application | PostgreSQL | Parameterized queries, encrypted connection, least-privilege roles |
| API → Redis | Application | Redis/BullMQ | AUTH password, private network, TLS |
| API → Gift Card Provider | Our backend | External API | mTLS, API key rotation, webhook signature verification |

## STRIDE Analysis

| Threat | Component | Risk | Attack Scenario | Mitigation |
|--------|-----------|------|-----------------|------------|
| **Spoofing** | Auth endpoint | High | Fake driver registration, stolen JWTs | Phone/email verification, short-lived JWTs (15min), refresh token rotation |
| **Spoofing** | Data ingestion | Critical | Fabricated trip data to earn fake points | Server-side validation: trip timestamp plausibility, fare range checks, velocity checks (can't submit 100 trips/hour), cross-reference activity feed with individual trips |
| **Tampering** | Trip payloads | High | Modified fare amounts before submission | HMAC signature of raw Uber response at capture time, payload hash stored on first submission, reject if hash differs on re-submission |
| **Repudiation** | Point redemption | High | Driver denies redeeming gift card | Immutable audit log, redemption requires 2FA confirmation, gift card delivery receipts |
| **Info Disclosure** | API errors | Medium | Stack traces leak DB schema | Generic error responses in production, structured logging to internal observability |
| **Info Disclosure** | Trip data | High | Other drivers' data exposed via IDOR | All queries scoped to authenticated driver_id, no sequential IDs (use UUIDs) |
| **DoS** | Public API | High | Credential stuffing, scraping | Rate limiting (100 req/15min per IP), account lockout after 5 failed attempts |
| **Elevation of Privilege** | Admin panel | Critical | Driver escalates to admin | Separate admin auth flow, RBAC with server-side enforcement, admin actions require MFA |

## Data Protection Controls

### Encryption
- **At rest**: AES-256-GCM for PII fields (name, phone, email) via application-level encryption
- **In transit**: TLS 1.3 enforced on all endpoints
- **Database**: Column-level encryption for sensitive fields, full-disk encryption on database server
- **Backups**: Encrypted with separate key, stored in different region

### Data Minimization
- We store only: trip UUID, timestamp, fare breakdown, pickup/dropoff district (NOT full address), vehicle type
- Map images and full addresses from Uber response are discarded at ingestion
- Raw Uber payloads are retained for 30 days for dispute resolution, then purged

### Access Control
- Drivers can only access their own data (row-level security)
- Admin access requires MFA + IP allowlisting
- Database credentials rotated every 90 days
- All admin actions logged to immutable audit trail
