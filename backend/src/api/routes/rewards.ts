import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../../config/database.js';
import {
  getGiftCardCatalog,
  redeemGiftCard,
  getDriverRedemptions,
} from '../../services/redemption-service.js';
import { getSyncWindow } from '../../utils/sync-window.js';
import type { Region } from '@prisma/client';

const router = Router();

router.use(authenticate);

router.get('/balance', async (req: Request, res: Response, next) => {
  try {
    const driverId = req.driver!.sub;
    const region = req.driver!.region as Region;

    const driver = await prisma.driver.findUniqueOrThrow({
      where: { id: driverId },
      select: {
        pointsBalance: true,
        lifetimePoints: true,
        referralCode: true,
      },
    });

    // Monthly breakdown: last 6 months of trip_earn points
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const ledgerEntries = await prisma.pointLedger.findMany({
      where: {
        driverId,
        type: 'trip_earn',
        amount: { gt: 0 },
        createdAt: { gte: sixMonthsAgo },
      },
      select: { amount: true, createdAt: true },
    });

    const monthMap = new Map<string, number>();
    for (const entry of ledgerEntries) {
      const d = entry.createdAt;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, (monthMap.get(key) ?? 0) + entry.amount);
    }

    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthToDate = monthMap.get(currentMonthKey) ?? 0;

    const monthlyBreakdown = Array.from(monthMap.entries())
      .map(([month, earned]) => ({ month, earned }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const syncWindow = getSyncWindow(region);

    res.json({
      ...driver,
      monthToDate,
      monthlyBreakdown,
      syncWindow,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req: Request, res: Response, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      prisma.pointLedger.findMany({
        where: { driverId: req.driver!.sub },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          amount: true,
          balance: true,
          type: true,
          description: true,
          createdAt: true,
        },
      }),
      prisma.pointLedger.count({ where: { driverId: req.driver!.sub } }),
    ]);

    res.json({ entries, total, page, limit });
  } catch (err) {
    next(err);
  }
});

router.get('/gift-cards', async (req: Request, res: Response, next) => {
  try {
    const region = req.driver!.region as Region;
    const catalog = await getGiftCardCatalog(region);
    res.json({ giftCards: catalog });
  } catch (err) {
    next(err);
  }
});

router.post('/redeem', async (req: Request, res: Response, next) => {
  try {
    const { giftCardId } = req.body as { giftCardId: string };
    if (!giftCardId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(giftCardId)) {
      res.status(400).json({ error: 'Valid giftCardId (UUID) is required' });
      return;
    }

    const result = await redeemGiftCard(req.driver!.sub, giftCardId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/redemptions', async (req: Request, res: Response, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

    const result = await getDriverRedemptions(req.driver!.sub, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { router as rewardsRouter };
