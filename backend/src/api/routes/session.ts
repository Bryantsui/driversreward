import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../../config/database.js';
import { encrypt } from '../../utils/encryption.js';
import { logger } from '../../config/logger.js';
import { enqueueScrapeJob } from '../../workers/scrape-worker.js';
import { isProxyConfigured } from '../../services/proxy-manager.js';
import type { Region } from '@prisma/client';

const router = Router();

router.use(authenticate);

router.post('/heartbeat', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;
    const source = (req.body.source as string) || 'unknown';

    const existingSession = await prisma.uberSession.findFirst({
      where: { driverId, source, isActive: true },
    });

    if (existingSession) {
      await prisma.uberSession.update({
        where: { id: existingSession.id },
        data: { lastHeartbeat: new Date() },
      });

      res.json({
        sessionId: existingSession.id,
        status: 'active',
        sessionDurationMinutes: Math.floor(
          (Date.now() - existingSession.sessionStarted.getTime()) / 60_000,
        ),
      });
    } else {
      const session = await prisma.uberSession.create({
        data: {
          driverId,
          source,
          userAgent: req.headers['user-agent'],
        },
      });

      res.status(201).json({
        sessionId: session.id,
        status: 'created',
        sessionDurationMinutes: 0,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.post('/end', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;
    const source = (req.body.source as string) || 'unknown';

    await prisma.uberSession.updateMany({
      where: { driverId, source, isActive: true },
      data: { isActive: false, sessionEnded: new Date() },
    });

    res.json({ status: 'ended' });
  } catch (err) {
    next(err);
  }
});

router.get('/status', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;

    const sessions = await prisma.uberSession.findMany({
      where: { driverId, isActive: true },
      orderBy: { lastHeartbeat: 'desc' },
    });

    res.json({
      activeSessions: sessions.map((s) => ({
        id: s.id,
        source: s.source,
        lastHeartbeat: s.lastHeartbeat,
        sessionStarted: s.sessionStarted,
        durationMinutes: Math.floor((Date.now() - s.sessionStarted.getTime()) / 60_000),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ═══════════════ UBER CREDENTIAL MANAGEMENT ═══════════════

const storeTokenSchema = z.object({
  cookies: z.string().min(10).max(10_000),
  csrfToken: z.string().min(5).max(500),
  userAgent: z.string().min(10).max(500),
  source: z.enum(['chrome_extension', 'android_app']),
});

router.post('/store-credential', async (req: Request, res: Response, next) => {
  try {
    const input = storeTokenSchema.parse(req.body);
    const driverId = req.driver!.sub;
    const region = req.driver!.region as Region;

    const cookiesEncrypted = encrypt(input.cookies);
    const csrfEncrypted = encrypt(input.csrfToken);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    await prisma.uberCredential.upsert({
      where: { driverId },
      update: {
        cookiesEncrypted,
        csrfEncrypted,
        userAgent: input.userAgent,
        source: input.source,
        isValid: true,
        invalidReason: null,
        capturedAt: new Date(),
        expiresAt,
      },
      create: {
        driverId,
        cookiesEncrypted,
        csrfEncrypted,
        userAgent: input.userAgent,
        region,
        source: input.source,
        capturedAt: new Date(),
        expiresAt,
      },
    });

    logger.info({ driverId, source: input.source }, 'Uber credential stored');
    res.json({ status: 'stored', expiresAt: expiresAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

router.delete('/revoke-credential', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;

    const result = await prisma.uberCredential.updateMany({
      where: { driverId, isValid: true },
      data: { isValid: false, invalidReason: 'Revoked by driver' },
    });

    logger.info({ driverId, revoked: result.count }, 'Uber credential revoked');
    res.json({ status: 'revoked', count: result.count });
  } catch (err) {
    next(err);
  }
});

router.get('/credential-status', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;
    const region = req.driver!.region as Region;

    const credential = await prisma.uberCredential.findUnique({
      where: { driverId },
      select: {
        isValid: true,
        source: true,
        capturedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        invalidReason: true,
      },
    });

    const lastJob = await prisma.scrapeJob.findFirst({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, trigger: true, tripsFound: true, pointsAwarded: true, createdAt: true, completedAt: true },
    });

    const serverScrapeAvailable = !!(credential?.isValid) && isProxyConfigured(region);

    res.json({
      hasCredential: !!credential,
      isValid: credential?.isValid ?? false,
      source: credential?.source,
      capturedAt: credential?.capturedAt,
      expiresAt: credential?.expiresAt,
      lastUsedAt: credential?.lastUsedAt,
      invalidReason: credential?.invalidReason,
      serverScrapeAvailable,
      lastScrapeJob: lastJob,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/trigger-scrape', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;
    const region = req.driver!.region as Region;

    const credential = await prisma.uberCredential.findUnique({
      where: { driverId },
      select: { isValid: true },
    });

    if (!credential?.isValid) {
      res.status(400).json({ error: 'No valid Uber session stored. Please sync manually first.' });
      return;
    }

    if (!isProxyConfigured(region)) {
      res.status(503).json({ error: 'Server-side scraping not configured for your region yet.' });
      return;
    }

    // Check for existing running/queued job
    const existingJob = await prisma.scrapeJob.findFirst({
      where: { driverId, status: { in: ['queued', 'running'] } },
    });

    if (existingJob) {
      res.json({ status: 'already_queued', scrapeJobId: existingJob.id });
      return;
    }

    // Cooldown: max 1 manual trigger per 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentManual = await prisma.scrapeJob.findFirst({
      where: { driverId, trigger: 'manual', createdAt: { gte: oneDayAgo } },
      orderBy: { createdAt: 'desc' },
    });

    if (recentManual) {
      res.status(429).json({ error: 'You can trigger a manual sync once per day. Please try again later.' });
      return;
    }

    const jobId = await enqueueScrapeJob(driverId, 'manual');
    logger.info({ driverId, jobId }, 'Manual scrape triggered');
    res.json({ status: 'queued', scrapeJobId: jobId });
  } catch (err) {
    next(err);
  }
});

router.get('/scrape-job/:id', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;
    const job = await prisma.scrapeJob.findFirst({
      where: { id: req.params.id as string, driverId },
    });

    if (!job) {
      res.status(404).json({ error: 'Scrape job not found' });
      return;
    }

    res.json(job);
  } catch (err) {
    next(err);
  }
});

export { router as sessionRouter };
