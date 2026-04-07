import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import { testPrisma, cleanDatabase, createTestDriver } from '../helpers.js';

describe('Auth API', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  describe('POST /api/auth/register', () => {
    it('registers a new HK driver and returns tokens', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'driver1@test.com',
          password: 'Password123!',
          name: 'Test Driver HK',
          region: 'HK',
          consentDataCollection: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.driver).toBeDefined();
      expect(res.body.driver.email).toBe('driver1@test.com');
      expect(res.body.driver.region).toBe('HK');
      expect(res.body.driver.referralCode).toBeDefined();
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();

      // Verify consent was recorded
      const consent = await testPrisma.consent.findFirst({
        where: { driverId: res.body.driver.id },
      });
      expect(consent).toBeDefined();
      expect(consent!.type).toBe('DATA_COLLECTION');
      expect(consent!.granted).toBe(true);
    });

    it('registers a BR driver', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'motorista@test.com',
          password: 'Senha12345!',
          name: 'Motorista Brasileiro',
          region: 'BR',
          consentDataCollection: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.driver.region).toBe('BR');
    });

    it('rejects duplicate email', async () => {
      await createTestDriver({ email: 'dupe@test.com' });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'dupe@test.com',
          password: 'Password123!',
          name: 'Dupe Driver',
          region: 'HK',
          consentDataCollection: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_EXISTS');
    });

    it('rejects missing consent', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'noconsent@test.com',
          password: 'Password123!',
          name: 'No Consent',
          region: 'HK',
          consentDataCollection: false,
        });

      expect(res.status).toBe(400);
    });

    it('rejects weak password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'weak@test.com',
          password: '123',
          name: 'Weak Pass',
          region: 'HK',
          consentDataCollection: true,
        });

      expect(res.status).toBe(400);
    });

    it('supports referral code', async () => {
      const { driver: referrer } = await createTestDriver();

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'referred@test.com',
          password: 'Password123!',
          name: 'Referred Driver',
          region: 'HK',
          referralCode: referrer.referralCode,
          consentDataCollection: true,
        });

      expect(res.status).toBe(201);

      const referred = await testPrisma.driver.findUnique({
        where: { id: res.body.driver.id },
      });
      expect(referred!.referredBy).toBe(referrer.id);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with correct credentials', async () => {
      const { driver, password } = await createTestDriver({ email: 'login@test.com' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'login@test.com', password });

      expect(res.status).toBe(200);
      expect(res.body.driver.id).toBe(driver.id);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
    });

    it('rejects wrong password', async () => {
      await createTestDriver({ email: 'wrongpw@test.com' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'wrongpw@test.com', password: 'WrongPassword!' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'noexist@test.com', password: 'Anything123!' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates refresh token and returns new pair', async () => {
      const { driver, password } = await createTestDriver({ email: 'refresh@test.com' });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'refresh@test.com', password });

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: loginRes.body.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.refreshToken).not.toBe(loginRes.body.refreshToken);
    });

    it('rejects reused refresh token (rotation)', async () => {
      const { password } = await createTestDriver({ email: 'reuse@test.com' });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'reuse@test.com', password });

      // First refresh — succeeds
      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: loginRes.body.refreshToken });

      // Second refresh with same token — should fail (already revoked)
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: loginRes.body.refreshToken });

      expect(res.status).toBe(401);
    });
  });
});
