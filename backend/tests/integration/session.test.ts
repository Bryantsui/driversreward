import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import { testPrisma, cleanDatabase, createTestDriver, createTestAdmin } from '../helpers.js';

describe('Session API', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  describe('POST /api/session/heartbeat', () => {
    it('creates a new session on first heartbeat', async () => {
      const { accessToken, driver } = await createTestDriver();

      const res = await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'chrome_extension' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('created');
      expect(res.body.sessionId).toBeDefined();

      const session = await testPrisma.uberSession.findFirst({
        where: { driverId: driver.id },
      });
      expect(session).toBeDefined();
      expect(session!.isActive).toBe(true);
      expect(session!.source).toBe('chrome_extension');
    });

    it('updates existing session on subsequent heartbeat', async () => {
      const { accessToken, driver } = await createTestDriver();

      // First heartbeat
      const first = await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'chrome_extension' });

      // Second heartbeat
      const res = await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'chrome_extension' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('active');
      expect(res.body.sessionId).toBe(first.body.sessionId);

      // Only one session in DB
      const count = await testPrisma.uberSession.count({
        where: { driverId: driver.id, isActive: true },
      });
      expect(count).toBe(1);
    });

    it('supports separate sessions for different sources', async () => {
      const { accessToken, driver } = await createTestDriver();

      await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'chrome_extension' });

      await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'android_app' });

      const count = await testPrisma.uberSession.count({
        where: { driverId: driver.id, isActive: true },
      });
      expect(count).toBe(2);
    });
  });

  describe('POST /api/session/end', () => {
    it('ends active session', async () => {
      const { accessToken, driver } = await createTestDriver();

      await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'chrome_extension' });

      const res = await request(app)
        .post('/api/session/end')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'chrome_extension' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ended');

      const session = await testPrisma.uberSession.findFirst({
        where: { driverId: driver.id },
      });
      expect(session!.isActive).toBe(false);
      expect(session!.sessionEnded).toBeDefined();
    });
  });

  describe('GET /api/session/status', () => {
    it('returns active sessions for driver', async () => {
      const { accessToken } = await createTestDriver();

      await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ source: 'chrome_extension' });

      const res = await request(app)
        .get('/api/session/status')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.activeSessions).toHaveLength(1);
      expect(res.body.activeSessions[0].source).toBe('chrome_extension');
      expect(res.body.activeSessions[0].durationMinutes).toBeDefined();
    });
  });

  describe('Admin session monitoring (GET /api/admin/sessions)', () => {
    it('shows all active sessions with health status', async () => {
      const { token } = await createTestAdmin();
      const { accessToken: d1Token } = await createTestDriver({ email: 'sess1@test.com' });
      const { accessToken: d2Token } = await createTestDriver({ email: 'sess2@test.com' });

      await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${d1Token}`)
        .send({ source: 'chrome_extension' });

      await request(app)
        .post('/api/session/heartbeat')
        .set('Authorization', `Bearer ${d2Token}`)
        .send({ source: 'android_app' });

      const res = await request(app)
        .get('/api/admin/sessions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(2);
      expect(res.body.sessions[0].health).toBe('healthy');
      expect(res.body.sessions[0].driver).toBeDefined();
    });
  });
});
