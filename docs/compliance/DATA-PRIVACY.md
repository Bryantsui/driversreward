# Data Privacy Compliance: PDPO (Hong Kong) & LGPD (Brazil)

## Overview

This programme collects financial data from Uber drivers in two jurisdictions:
- **Hong Kong**: Personal Data (Privacy) Ordinance (PDPO), Cap. 486
- **Brazil**: Lei Geral de Proteção de Dados (LGPD), Lei nº 13.709/2018

## Data We Collect

| Data Field | Classification | Retention | Encryption |
|------------|---------------|-----------|------------|
| Email address | PII | Account lifetime + 30 days | At rest (column-level) |
| Full name | PII | Account lifetime + 30 days | AES-256-GCM (application-level) |
| Phone number | PII | Account lifetime + 30 days | At rest |
| Trip UUID | Non-PII | Indefinite (anonymized after deletion) | No |
| Fare breakdown | Financial | Indefinite (anonymized after deletion) | At rest |
| Pickup/dropoff district | Quasi-PII | Indefinite (coarsened to district level) | No |
| Raw Uber API payload | Mixed | **30 days** then auto-purged | At rest |
| IP address (in logs) | PII | **90 days** then auto-purged | No |
| Points/redemption history | Non-PII | Indefinite | No |

## Data Protection Principles

### PDPO (Hong Kong) — 6 Data Protection Principles

1. **DPP1 — Purpose & Manner of Collection**
   - Data collected solely for reward programme operation
   - Clear consent obtained at registration (mandatory checkbox)
   - Privacy policy displayed before account creation

2. **DPP2 — Accuracy**
   - Data sourced directly from Uber's API (driver-initiated)
   - Drivers can view and dispute their submitted trip data

3. **DPP3 — Use**
   - Trip data used exclusively for: points calculation, programme analytics
   - NOT shared with third parties except gift card fulfillment providers (name + email only)
   - No data sold or used for advertising

4. **DPP4 — Security**
   - AES-256-GCM encryption for PII at application level
   - TLS 1.3 for all data in transit
   - Row-level security (drivers access only their own data)
   - Admin access requires MFA + IP allowlist

5. **DPP5 — Openness**
   - Privacy policy publicly available
   - Data processing activities documented
   - Contact information for data enquiries provided

6. **DPP6 — Access & Correction**
   - Drivers can request full data export via API endpoint
   - Drivers can request data correction or deletion
   - Response within 40 days (PDPO requirement)

### LGPD (Brazil) — Key Requirements

1. **Legal Basis**: Consent (Art. 7, I) — explicit opt-in at registration
2. **Data Subject Rights (Art. 18)**:
   - Right to confirmation and access
   - Right to correction
   - Right to anonymization, blocking, or deletion
   - Right to data portability
   - Right to revoke consent
3. **DPO Appointment**: Required — designated Data Protection Officer contact
4. **International Transfer**: Data stored in AWS São Paulo (sa-east-1) for Brazilian drivers;
   if cross-border transfer needed, Standard Contractual Clauses apply
5. **Breach Notification**: ANPD must be notified within "reasonable time" of incidents
   affecting personal data

## Technical Controls

### Consent Management
- `consents` table tracks all consent grants/revocations with timestamps
- Consent required before any data collection begins
- Granular consent types: DATA_COLLECTION, MARKETING, DATA_SHARING
- Revocation immediately stops new data collection; existing data retained per retention policy

### Data Subject Requests (DSR)

```
GET  /api/driver/me           → View all personal data
GET  /api/driver/trips        → View all submitted trips
POST /api/driver/export       → Request full data export (JSON)
POST /api/driver/delete       → Request account deletion
POST /api/driver/consent      → Update consent preferences
```

### Account Deletion Flow
1. Driver requests deletion → status set to `DELETED`, `deleted_at` timestamp
2. Immediate: Access tokens revoked, login disabled
3. Within 30 days: PII fields (name, email, phone) are purged/anonymized
4. Trip data anonymized (driver_id replaced with hash, districts removed)
5. Points and redemption history retained in anonymized form for financial records
6. Audit log entry created (immutable)

### Automated Data Purge Jobs
- **Raw payload purge**: Daily cron deletes `raw_payload` where `raw_payload_purge_at < NOW()`
- **IP address purge**: 90-day TTL on IP addresses in audit logs and consent records
- **Expired token cleanup**: Daily cron removes expired refresh tokens
- **Point expiry**: Annual check for expired points (365-day expiry from earn date)

## Incident Response

1. Security incidents documented in `audit_logs` table
2. Breach assessment within 24 hours
3. PCPD (HK) notification within 5 business days if significant
4. ANPD (BR) notification within "reasonable time" per LGPD
5. Affected drivers notified via email within 72 hours
