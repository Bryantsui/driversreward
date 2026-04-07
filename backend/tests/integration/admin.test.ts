import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import {
  testPrisma,
  cleanDatabase,
  createTestDriver,
  createTestAdmin,
  makeTripPayload,
} from '../helpers.js';

describe('Admin API', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  describe('POST /api/admin/login', () => {
    it('logs in with valid admin credentials', async () => {
      const { admin, password } = await createTestAdmin();

      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: admin.email, password });

      expect(res.status).toBe(200);
      expect(res.body.admin.id).toBe(admin.id);
      expect(res.body.admin.role).toBe('SUPER_ADMIN');
      expect(res.body.token).toBeDefined();
    });

    it('rejects invalid admin password', async () => {
      const { admin } = await createTestAdmin();

      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: admin.email, password: 'WrongPassword!' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/dashboard', () => {
    it('returns overview stats', async () => {
      const { token } = await createTestAdmin();

      // Create some test data
      const { accessToken: driverToken } = await createTestDriver();
      const trip = makeTripPayload({ netEarnings: 30 });
      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.drivers.total).toBe(1);
      expect(res.body.trips.total).toBe(1);
      expect(res.body.trips.pendingReview).toBe(1);
      expect(res.body.points.totalIssued).toBe(30);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/admin/dashboard');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/drivers', () => {
    it('lists all drivers with trip/redemption counts', async () => {
      const { token } = await createTestAdmin();
      await createTestDriver({ email: 'hk1@test.com', region: 'HK' });
      await createTestDriver({ email: 'br1@test.com', region: 'BR' });

      const res = await request(app)
        .get('/api/admin/drivers')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.drivers).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('filters by region', async () => {
      const { token } = await createTestAdmin();
      await createTestDriver({ email: 'hk1@test.com', region: 'HK' });
      await createTestDriver({ email: 'br1@test.com', region: 'BR' });

      const res = await request(app)
        .get('/api/admin/drivers?region=HK')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.drivers).toHaveLength(1);
      expect(res.body.drivers[0].region).toBe('HK');
    });
  });

  describe('GET /api/admin/drivers/:id', () => {
    it('returns detailed driver info with trip stats and session info', async () => {
      const { token } = await createTestAdmin();
      const { driver, accessToken: driverToken } = await createTestDriver();

      // Submit trips
      const trips = Array.from({ length: 3 }, () => makeTripPayload({ netEarnings: 25 }));
      trips.forEach((t, i) => { t.rawPayloadHash = `${'d'.repeat(63)}${i}`; });
      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips, source: 'chrome_extension' });

      const res = await request(app)
        .get(`/api/admin/drivers/${driver.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.driver.id).toBe(driver.id);
      expect(res.body.tripStats.PENDING_REVIEW).toBe(3);
      expect(res.body.weeklyContribution).toBe(3);
    });
  });

  describe('GET /api/admin/trips', () => {
    it('lists trips with filters', async () => {
      const { token } = await createTestAdmin();
      const { accessToken: driverToken } = await createTestDriver();

      const trips = Array.from({ length: 5 }, () => makeTripPayload({ netEarnings: 30 }));
      trips.forEach((t, i) => { t.rawPayloadHash = `${'e'.repeat(63)}${i}`; });
      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips, source: 'chrome_extension' });

      const res = await request(app)
        .get('/api/admin/trips?reviewStatus=PENDING_REVIEW')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.trips).toHaveLength(5);
      expect(res.body.total).toBe(5);
      expect(res.body.trips[0].driver).toBeDefined();
      expect(res.body.trips[0].reviewStatus).toBe('PENDING_REVIEW');
    });

    it('paginates results', async () => {
      const { token } = await createTestAdmin();
      const { accessToken: driverToken } = await createTestDriver();

      const trips = Array.from({ length: 10 }, () => makeTripPayload({ netEarnings: 30 }));
      trips.forEach((t, i) => { t.rawPayloadHash = `${'f'.repeat(63)}${i}`; });
      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips, source: 'chrome_extension' });

      const res = await request(app)
        .get('/api/admin/trips?page=1&limit=3')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.trips).toHaveLength(3);
      expect(res.body.total).toBe(10);
    });
  });

  describe('POST /api/admin/trips/:id/review', () => {
    it('approves a trip', async () => {
      const { token, admin } = await createTestAdmin();
      const { accessToken: driverToken, driver } = await createTestDriver();

      const trip = makeTripPayload({ netEarnings: 40 });
      const submitRes = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      const tripId = submitRes.body.trips[0].tripId;

      const res = await request(app)
        .post(`/api/admin/trips/${tripId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'APPROVED', note: 'Looks good' });

      expect(res.status).toBe(200);
      expect(res.body.reviewStatus).toBe('APPROVED');
      expect(res.body.reviewedBy).toBe(admin.id);

      // Points should remain (not clawed back)
      const updatedDriver = await testPrisma.driver.findUnique({ where: { id: driver.id } });
      expect(updatedDriver!.pointsBalance).toBe(40);
    });

    it('flags a suspicious trip', async () => {
      const { token } = await createTestAdmin();
      const { accessToken: driverToken } = await createTestDriver();

      const trip = makeTripPayload({ netEarnings: 40 });
      const submitRes = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      const tripId = submitRes.body.trips[0].tripId;

      const res = await request(app)
        .post(`/api/admin/trips/${tripId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'FLAGGED', note: 'Fare seems high for distance' });

      expect(res.status).toBe(200);
      expect(res.body.reviewStatus).toBe('FLAGGED');
      expect(res.body.flagReason).toBe('Fare seems high for distance');
    });

    it('rejects a trip and claws back points', async () => {
      const { token } = await createTestAdmin();
      const { accessToken: driverToken, driver } = await createTestDriver();

      const trip = makeTripPayload({ netEarnings: 40 });
      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      const savedTrip = await testPrisma.trip.findFirst({ where: { driverId: driver.id } });

      const res = await request(app)
        .post(`/api/admin/trips/${savedTrip!.id}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'REJECTED', note: 'Fabricated trip data' });

      expect(res.status).toBe(200);
      expect(res.body.reviewStatus).toBe('REJECTED');

      // Points should be clawed back
      const updatedDriver = await testPrisma.driver.findUnique({ where: { id: driver.id } });
      expect(updatedDriver!.pointsBalance).toBe(0);

      // Verify adjustment ledger entry
      const adjustment = await testPrisma.pointLedger.findFirst({
        where: { driverId: driver.id, type: 'adjustment' },
      });
      expect(adjustment).toBeDefined();
      expect(adjustment!.amount).toBe(-40);
    });

    it('rejects review from VIEWER role', async () => {
      const { token } = await createTestAdmin({ role: 'VIEWER' });
      const { accessToken: driverToken } = await createTestDriver();

      const trip = makeTripPayload();
      const submitRes = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      const tripId = submitRes.body.trips[0].tripId;

      const res = await request(app)
        .post(`/api/admin/trips/${tripId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'APPROVED' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/trips/bulk-review', () => {
    it('bulk approves multiple trips', async () => {
      const { token } = await createTestAdmin();
      const { accessToken: driverToken } = await createTestDriver();

      const trips = Array.from({ length: 5 }, () => makeTripPayload({ netEarnings: 20 }));
      trips.forEach((t, i) => { t.rawPayloadHash = `${'g'.repeat(63)}${i}`; });

      const submitRes = await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ trips, source: 'chrome_extension' });

      const tripIds = submitRes.body.trips.map((t: any) => t.tripId);

      const res = await request(app)
        .post('/api/admin/trips/bulk-review')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tripIds,
          action: 'APPROVED',
          note: 'Batch approved — weekly review',
        });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(5);
      expect(res.body.results.every((r: any) => r.success)).toBe(true);

      // Verify all approved in DB
      const approvedCount = await testPrisma.trip.count({
        where: { reviewStatus: 'APPROVED' },
      });
      expect(approvedCount).toBe(5);
    });
  });
});
