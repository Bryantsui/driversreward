import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../../config/database.js';

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

export { router as sessionRouter };
