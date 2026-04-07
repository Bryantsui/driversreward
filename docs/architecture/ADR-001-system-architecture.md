# ADR-001: System Architecture — Modular Monolith with Event-Driven Async

## Status
Accepted

## Context
We're building a reward programme for Uber drivers in Hong Kong and Brazil. Drivers share
trip earnings data via two ingestion channels (Chrome Extension, Android Gateway App).
Data is collected, normalized, and converted into reward points redeemable for gift cards.

Key constraints:
- Two distinct regions (HK, BR) with different privacy laws (PDPO, LGPD)
- Financial data sensitivity requires encryption at rest and in transit
- Uber's driver portal APIs are session-based with CSRF tokens — we never store Uber credentials
- Must handle eventual consistency (drivers may submit overlapping data)
- Small team at launch — microservices overhead is premature

## Decision
**Modular Monolith** deployed as a single Node.js/TypeScript service with clear domain boundaries,
backed by PostgreSQL and Redis. Async work (point calculations, gift card fulfillment) runs via
a job queue (BullMQ on Redis).

### Bounded Contexts
1. **Identity** — Driver registration, authentication (JWT), region assignment
2. **Ingestion** — Receives raw trip data, deduplicates by trip UUID, normalizes currencies
3. **Rewards** — Points engine: calculates points per trip, manages balances, handles tiers
4. **Redemption** — Gift card catalog, redemption requests, fulfillment tracking
5. **Compliance** — Consent management, data retention, export/deletion (PDPO + LGPD)

### Communication
- In-process domain events between bounded contexts (EventEmitter / in-memory bus)
- BullMQ for async jobs (point recalculation, gift card provisioning, data export)
- REST API for client-facing endpoints (Chrome Extension, Android App, Admin Dashboard)

## Consequences
**Easier**: Single deployment, shared database transactions, simpler debugging, fast iteration
**Harder**: Must enforce module boundaries via code review and lint rules; will need to extract
services if regions diverge significantly or scale demands independent scaling
