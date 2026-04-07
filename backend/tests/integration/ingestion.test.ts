import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import { testPrisma, cleanDatabase, createTestDriver, makeTripPayload } from '../helpers.js';

describe('Ingestion API', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  describe('POST /api/ingest/trips', () => {
    it('submits a single trip and awards points', async () => {
      const { accessToken, driver } = await createTestDriver();
      const trip = makeTripPayload({ netEarnings: 34 });

      const res = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      expect(res.status).toBe(201);
      expect(res.body.processed).toBe(1);
      expect(res.body.newTrips).toBe(1);
      expect(res.body.duplicates).toBe(0);
      expect(res.body.totalPointsAwarded).toBe(34); // 1 point per HKD

      // Verify DB state
      const updatedDriver = await testPrisma.driver.findUnique({ where: { id: driver.id } });
      expect(updatedDriver!.pointsBalance).toBe(34);
      expect(updatedDriver!.lifetimePoints).toBe(34);

      // Verify trip was saved with PENDING_REVIEW status
      const savedTrip = await testPrisma.trip.findFirst({ where: { driverId: driver.id } });
      expect(savedTrip!.reviewStatus).toBe('PENDING_REVIEW');
    });

    it('submits a batch of 5 trips', async () => {
      const { accessToken } = await createTestDriver();
      const trips = Array.from({ length: 5 }, (_, i) =>
        makeTripPayload({
          fareAmount: 60 + i * 10,
          netEarnings: 30 + i * 5,
        }),
      );

      trips.forEach((t, i) => {
        t.rawPayloadHash = `${'b'.repeat(63)}${i}`;
      });

      const res = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips, source: 'chrome_extension' });

      expect(res.status).toBe(201);
      expect(res.body.processed).toBe(5);
      expect(res.body.newTrips).toBe(5);
    });

    it('deduplicates by trip UUID', async () => {
      const { accessToken } = await createTestDriver();
      const trip = makeTripPayload();

      // First submission
      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      // Second submission — same UUID
      const res = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      expect(res.status).toBe(201);
      expect(res.body.duplicates).toBe(1);
      expect(res.body.newTrips).toBe(0);
      expect(res.body.totalPointsAwarded).toBe(0); // no double points
    });

    it('rejects implausible fare (> HKD 5000)', async () => {
      const { accessToken } = await createTestDriver();
      const trip = makeTripPayload({ fareAmount: 6000, netEarnings: 5000 });

      const res = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('IMPLAUSIBLE_FARE');
    });

    it('rejects net earnings > fare amount', async () => {
      const { accessToken } = await createTestDriver();
      const trip = makeTripPayload({ fareAmount: 30, netEarnings: 50 });

      const res = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_EARNINGS');
    });

    it('rejects future trip timestamp', async () => {
      const { accessToken } = await createTestDriver();
      const trip = makeTripPayload({ requestedAt: Math.floor(Date.now() / 1000) + 86400 });

      const res = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_TIMESTAMP');
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app)
        .post('/api/ingest/trips')
        .send({ trips: [makeTripPayload()], source: 'chrome_extension' });

      expect(res.status).toBe(401);
    });

    it('awards surge bonus correctly', async () => {
      const { accessToken, driver } = await createTestDriver();
      const trip = makeTripPayload({ netEarnings: 40, isSurge: true });

      const res = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      expect(res.status).toBe(201);
      // 40 * 1.5 = 60 points
      expect(res.body.totalPointsAwarded).toBe(60);
    });

    it('awards 0 points for earnings below minimum', async () => {
      const { accessToken } = await createTestDriver();
      const trip = makeTripPayload({ fareAmount: 8, netEarnings: 5 });

      const res = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      expect(res.status).toBe(201);
      expect(res.body.totalPointsAwarded).toBe(0);
    });

    it('creates point ledger entry for each trip', async () => {
      const { accessToken, driver } = await createTestDriver();
      const trip = makeTripPayload({ fareAmount: 80, netEarnings: 50 });

      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      const ledger = await testPrisma.pointLedger.findMany({
        where: { driverId: driver.id },
      });

      expect(ledger).toHaveLength(1);
      expect(ledger[0].amount).toBe(50);
      expect(ledger[0].type).toBe('trip_earn');
      expect(ledger[0].expiresAt).toBeDefined(); // 365-day expiry
    });
  });

  describe('POST /api/ingest/activity-feed', () => {
    it('identifies new trip UUIDs vs already submitted', async () => {
      const { accessToken, driver } = await createTestDriver();

      // Submit one trip first
      const existingTrip = makeTripPayload();
      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [existingTrip], source: 'chrome_extension' });

      // Now submit activity feed containing the existing trip + 2 new ones
      const res = await request(app)
        .post('/api/ingest/activity-feed')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          startDate: '2026-03-01',
          endDate: '2026-04-07',
          trips: [
            { uuid: existingTrip.tripUuid, activityTitle: 'UberX', formattedTotal: 'HK$34', type: 'TRIP' },
            { uuid: '11111111-1111-1111-1111-111111111111', activityTitle: 'UberX', formattedTotal: 'HK$50', type: 'TRIP' },
            { uuid: '22222222-2222-2222-2222-222222222222', activityTitle: 'Quest', formattedTotal: 'HK$100', type: 'QUEST' },
          ],
          source: 'chrome_extension',
        });

      expect(res.status).toBe(200);
      expect(res.body.totalTrips).toBe(2); // only TRIP type counted
      expect(res.body.alreadySubmitted).toBe(1);
      expect(res.body.newTripsToFetch).toHaveLength(1);
      expect(res.body.newTripsToFetch[0]).toBe('11111111-1111-1111-1111-111111111111');
    });
  });
});
