import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import { testPrisma, cleanDatabase, createTestDriver, createTestGiftCard, makeTripPayload } from '../helpers.js';

describe('Rewards API', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  describe('GET /api/rewards/balance', () => {
    it('returns driver balance and lifetime points', async () => {
      const { accessToken, driver } = await createTestDriver();

      // Submit a trip to earn points
      const trip = makeTripPayload({ fareAmount: 80, netEarnings: 50 });
      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips: [trip], source: 'chrome_extension' });

      const res = await request(app)
        .get('/api/rewards/balance')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pointsBalance).toBe(50);
      expect(res.body.lifetimePoints).toBe(50);
      expect(res.body.referralCode).toBeDefined();
    });
  });

  describe('GET /api/rewards/gift-cards', () => {
    it('returns region-specific gift cards', async () => {
      const { accessToken } = await createTestDriver({ region: 'HK' });
      await createTestGiftCard('HK', { pointsCost: 100 });
      await createTestGiftCard('HK', { pointsCost: 200 });
      await createTestGiftCard('BR', { pointsCost: 100 }); // should NOT appear

      const res = await request(app)
        .get('/api/rewards/gift-cards')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.giftCards).toHaveLength(2);
      expect(res.body.giftCards.every((g: any) => g.pointsCost)).toBe(true);
    });

    it('excludes out-of-stock cards', async () => {
      const { accessToken } = await createTestDriver({ region: 'HK' });
      await createTestGiftCard('HK', { stockCount: 0 });

      const res = await request(app)
        .get('/api/rewards/gift-cards')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.giftCards).toHaveLength(0);
    });
  });

  describe('POST /api/rewards/redeem', () => {
    it('redeems a gift card and deducts points', async () => {
      const { accessToken, driver } = await createTestDriver({ pointsBalance: 500 });

      // Need to update lifetime points too for the test
      await testPrisma.driver.update({
        where: { id: driver.id },
        data: { pointsBalance: 500, lifetimePoints: 500 },
      });

      const giftCard = await createTestGiftCard('HK', { pointsCost: 100, stockCount: 5 });

      const res = await request(app)
        .post('/api/rewards/redeem')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ giftCardId: giftCard.id });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.pointsSpent).toBe(100);

      // Verify balance deducted
      const updatedDriver = await testPrisma.driver.findUnique({ where: { id: driver.id } });
      expect(updatedDriver!.pointsBalance).toBe(400);

      // Verify stock decremented
      const updatedCard = await testPrisma.giftCard.findUnique({ where: { id: giftCard.id } });
      expect(updatedCard!.stockCount).toBe(4);

      // Verify audit log
      const audit = await testPrisma.auditLog.findFirst({
        where: { driverId: driver.id, action: 'REDEEM_GIFT_CARD' },
      });
      expect(audit).toBeDefined();
    });

    it('rejects insufficient points', async () => {
      const { accessToken } = await createTestDriver({ pointsBalance: 50 });
      const giftCard = await createTestGiftCard('HK', { pointsCost: 100 });

      const res = await request(app)
        .post('/api/rewards/redeem')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ giftCardId: giftCard.id });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INSUFFICIENT_POINTS');
    });

    it('rejects cross-region redemption', async () => {
      const { accessToken } = await createTestDriver({ region: 'HK', pointsBalance: 500 });
      const brCard = await createTestGiftCard('BR', { pointsCost: 100 });

      const res = await request(app)
        .post('/api/rewards/redeem')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ giftCardId: brCard.id });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('REGION_MISMATCH');
    });

    it('rejects out-of-stock gift card', async () => {
      const { accessToken } = await createTestDriver({ pointsBalance: 500 });
      const giftCard = await createTestGiftCard('HK', { pointsCost: 100, stockCount: 0 });

      const res = await request(app)
        .post('/api/rewards/redeem')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ giftCardId: giftCard.id });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('OUT_OF_STOCK');
    });
  });

  describe('GET /api/rewards/history', () => {
    it('returns point ledger entries', async () => {
      const { accessToken, driver } = await createTestDriver();

      // Earn some points via trips
      const trips = Array.from({ length: 3 }, () => makeTripPayload({ netEarnings: 30 }));
      trips.forEach((t, i) => { t.rawPayloadHash = `${'c'.repeat(63)}${i}`; });

      await request(app)
        .post('/api/ingest/trips')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ trips, source: 'chrome_extension' });

      const res = await request(app)
        .get('/api/rewards/history')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(3);
      expect(res.body.total).toBe(3);
      expect(res.body.entries[0].type).toBe('trip_earn');
    });
  });
});
