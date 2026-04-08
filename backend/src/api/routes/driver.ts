import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../../config/database.js';
import { decrypt } from '../../utils/encryption.js';

const router = Router();

router.use(authenticate);

router.get('/me', async (req: Request, res: Response, next) => {
  try {
    const driver = await prisma.driver.findUniqueOrThrow({
      where: { id: req.driver!.sub },
      select: {
        id: true,
        email: true,
        nameEncrypted: true,
        phone: true,
        region: true,
        status: true,
        pointsBalance: true,
        lifetimePoints: true,
        referralCode: true,
        emailVerified: true,
        phoneVerified: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });

    let name: string | null = null;
    if (driver.nameEncrypted) {
      try {
        const raw = Buffer.from(driver.nameEncrypted).toString('utf8');
        name = decrypt(raw);
      } catch {
        name = null;
      }
    }

    res.json({
      ...driver,
      name,
      nameEncrypted: undefined,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/trips', async (req: Request, res: Response, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const [trips, total] = await Promise.all([
      prisma.trip.findMany({
        where: { driverId: req.driver!.sub },
        orderBy: { requestedAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          tripUuid: true,
          vehicleType: true,
          requestedAt: true,
          durationSeconds: true,
          distanceMeters: true,
          pickupDistrict: true,
          dropoffDistrict: true,
          currency: true,
          fareAmount: true,
          netEarnings: true,
          tips: true,
          isSurge: true,
          pointsAwarded: true,
        },
      }),
      prisma.trip.count({ where: { driverId: req.driver!.sub } }),
    ]);

    res.json({ trips, total, page, limit });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;

    const [tripCount, tripStats, recentTrips] = await Promise.all([
      prisma.trip.count({ where: { driverId } }),
      prisma.trip.aggregate({
        where: { driverId },
        _sum: { netEarnings: true, tips: true },
        _avg: { netEarnings: true },
      }),
      prisma.trip.count({
        where: {
          driverId,
          requestedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    res.json({
      totalTrips: tripCount,
      tripsLast30Days: recentTrips,
      totalEarnings: tripStats._sum.netEarnings,
      totalTips: tripStats._sum.tips,
      averageEarnings: tripStats._avg.netEarnings,
    });
  } catch (err) {
    next(err);
  }
});

export { router as driverRouter };
