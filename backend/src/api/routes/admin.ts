import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateAdmin, requireRole } from '../middleware/admin-auth.js';
import {
  adminLogin,
  createAdmin,
  getDashboardOverview,
  getDashboardOverviewByRegion,
  getDriversList,
  getTripsForReview,
  reviewTrip,
  bulkReviewTrips,
  getDriverDetail,
  getDriverPointLedger,
  getSessionHealth,
  getAllRedemptions,
  fulfillRedemption,
  cancelRedemption,
  getGiftCardList,
  adminResetDriverPassword,
} from '../../services/admin-service.js';
import type { Region, TripReviewStatus } from '@prisma/client';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const reviewSchema = z.object({
  action: z.enum(['APPROVED', 'FLAGGED', 'REJECTED']),
  note: z.string().max(500).optional(),
});

const bulkReviewSchema = z.object({
  tripIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['APPROVED', 'FLAGGED', 'REJECTED']),
  note: z.string().max(500).optional(),
});

const giftCardSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  provider: z.string().min(1).max(100),
  region: z.enum(['HK', 'BR']),
  pointsCost: z.number().int().positive(),
  faceValue: z.number().positive(),
  currency: z.string().min(2).max(10),
  imageUrl: z.string().url().max(500).optional().nullable(),
  isActive: z.boolean().optional().default(true),
  stockCount: z.number().int().min(0).optional().default(100),
});

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1).max(200),
  role: z.enum(['SUPER_ADMIN', 'REVIEWER', 'VIEWER']).default('REVIEWER'),
});

// --- Public: Admin login ---
router.post('/login', async (req: Request, res: Response, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await adminLogin(input.email, input.password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- Protected routes below ---
router.use(authenticateAdmin);

// Dashboard overview (combined)
router.get('/dashboard', async (_req: Request, res: Response, next) => {
  try {
    const overview = await getDashboardOverview();
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

// Dashboard overview split by region
router.get('/dashboard/by-region', async (_req: Request, res: Response, next) => {
  try {
    const overview = await getDashboardOverviewByRegion();
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

// List drivers
router.get('/drivers', async (req: Request, res: Response, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const region = (Array.isArray(req.query.region) ? req.query.region[0] : req.query.region) as Region | undefined;
    const status = (Array.isArray(req.query.status) ? req.query.status[0] : req.query.status) as string | undefined;

    const result = await getDriversList({ region, status, page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Driver detail
router.get('/drivers/:id', async (req: Request, res: Response, next) => {
  try {
    const result = await getDriverDetail(req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// List trips for review (with filters)
router.get('/trips', async (req: Request, res: Response, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

    const q = (key: string) => {
      const val = req.query[key];
      return (Array.isArray(val) ? val[0] : val) as string | undefined;
    };

    const result = await getTripsForReview({
      region: q('region') as Region | undefined,
      reviewStatus: q('reviewStatus') as TripReviewStatus | undefined,
      driverId: q('driverId'),
      dateFrom: q('dateFrom'),
      dateTo: q('dateTo'),
      minFare: q('minFare') ? parseFloat(q('minFare')!) : undefined,
      maxFare: q('maxFare') ? parseFloat(q('maxFare')!) : undefined,
      page,
      limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// CSV export for trips (must be before /trips/:id to avoid matching "export" as an ID)
router.get('/trips/export', async (req: Request, res: Response, next) => {
  try {
    const q = (key: string) => {
      const val = req.query[key];
      return (Array.isArray(val) ? val[0] : val) as string | undefined;
    };

    const result = await getTripsForReview({
      region: q('region') as Region | undefined,
      reviewStatus: q('reviewStatus') as TripReviewStatus | undefined,
      driverId: q('driverId'),
      dateFrom: q('dateFrom'),
      dateTo: q('dateTo'),
      minFare: q('minFare') ? parseFloat(q('minFare')!) : undefined,
      maxFare: q('maxFare') ? parseFloat(q('maxFare')!) : undefined,
      page: 1,
      limit: 10000,
    });

    const csvHeaders = [
      'Trip UUID', 'Region', 'Vehicle Type', 'Requested At', 'Date Requested', 'Time Requested',
      'Duration (s)', 'Distance (m)', 'Currency', 'Fare Amount', 'Service Fee', 'Booking Fee',
      'Tolls', 'Tips', 'Surcharges', 'Promotions', 'Net Earnings',
      'Pickup Address', 'Pickup District', 'Dropoff Address', 'Dropoff District',
      'Pickup Lat', 'Pickup Lng', 'Dropoff Lat', 'Dropoff Lng',
      'Is Pool', 'Is Surge', 'Status Type', 'Trip Notes',
      'Points Awarded', 'Review Status', 'Flag Reason',
      'Driver Email', 'Driver Region', 'Source', 'Created At',
    ];

    const escapeCsv = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const rows = result.trips.map((t: any) => [
      t.tripUuid, t.region, t.vehicleType, t.requestedAt?.toISOString?.() || t.requestedAt,
      t.dateRequested, t.timeRequested, t.durationSeconds, t.distanceMeters,
      t.currency, t.fareAmount, t.serviceFee, t.bookingFee,
      t.tolls, t.tips, t.surcharges, t.promotions, t.netEarnings,
      t.pickupAddress, t.pickupDistrict, t.dropoffAddress, t.dropoffDistrict,
      t.pickupLat, t.pickupLng, t.dropoffLat, t.dropoffLng,
      t.isPoolType, t.isSurge, t.statusType, t.tripNotes,
      t.pointsAwarded, t.reviewStatus, t.flagReason,
      t.driver?.email, t.driver?.region, t.source, t.createdAt?.toISOString?.() || t.createdAt,
    ].map(escapeCsv).join(','));

    const csv = [csvHeaders.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trips_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// Single trip detail with raw payload
router.get('/trips/:id', async (req: Request, res: Response, next) => {
  try {
    const { prisma } = await import('../../config/database.js');
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id as string },
      include: {
        driver: { select: { id: true, email: true, region: true, status: true } },
        pointLedger: { select: { amount: true, type: true, createdAt: true } },
      },
    });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    res.json(trip);
  } catch (err) {
    next(err);
  }
});

// Review a single trip
router.post(
  '/trips/:id/review',
  requireRole('SUPER_ADMIN', 'REVIEWER'),
  async (req: Request, res: Response, next) => {
    try {
      const input = reviewSchema.parse(req.body);
      const result = await reviewTrip(req.params.id as string, req.admin!.sub, input.action, input.note);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Bulk review trips
router.post(
  '/trips/bulk-review',
  requireRole('SUPER_ADMIN', 'REVIEWER'),
  async (req: Request, res: Response, next) => {
    try {
      const input = bulkReviewSchema.parse(req.body);
      const results = await bulkReviewTrips(input.tripIds, req.admin!.sub, input.action, input.note);
      res.json({ results });
    } catch (err) {
      next(err);
    }
  },
);

// Uber session health
router.get('/sessions', async (_req: Request, res: Response, next) => {
  try {
    const sessions = await getSessionHealth();
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});

// Driver point ledger
router.get('/drivers/:id/ledger', async (req: Request, res: Response, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const result = await getDriverPointLedger(req.params.id as string, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Redemptions list
router.get('/redemptions', async (req: Request, res: Response, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const q = (key: string) => {
      const val = req.query[key];
      return (Array.isArray(val) ? val[0] : val) as string | undefined;
    };
    const result = await getAllRedemptions({
      region: q('region') as Region | undefined,
      status: q('status'),
      driverId: q('driverId'),
      page,
      limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Fulfill a redemption
router.post(
  '/redemptions/:id/fulfill',
  requireRole('SUPER_ADMIN', 'REVIEWER'),
  async (req: Request, res: Response, next) => {
    try {
      const { giftCardCode } = req.body as { giftCardCode: string };
      if (!giftCardCode) {
        res.status(400).json({ error: 'giftCardCode is required' });
        return;
      }
      const result = await fulfillRedemption(req.params.id as string, req.admin!.sub, giftCardCode);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Cancel a redemption (refunds points)
router.post(
  '/redemptions/:id/cancel',
  requireRole('SUPER_ADMIN', 'REVIEWER'),
  async (req: Request, res: Response, next) => {
    try {
      const { reason } = req.body as { reason: string };
      if (!reason) {
        res.status(400).json({ error: 'reason is required' });
        return;
      }
      const result = await cancelRedemption(req.params.id as string, req.admin!.sub, reason);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Gift cards catalog (admin view, includes stock + stats)
router.get('/gift-cards', async (_req: Request, res: Response, next) => {
  try {
    const cards = await getGiftCardList();
    res.json({ giftCards: cards });
  } catch (err) {
    next(err);
  }
});

// Create / update gift card
router.post(
  '/gift-cards',
  requireRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next) => {
    try {
      const input = giftCardSchema.parse(req.body);
      const { prisma } = await import('../../config/database.js');
      if (input.id) {
        const { id, ...data } = input;
        const card = await prisma.giftCard.update({ where: { id }, data });
        res.json(card);
      } else {
        const { id: _id, ...data } = input;
        const card = await prisma.giftCard.create({ data });
        res.status(201).json(card);
      }
    } catch (err) {
      next(err);
    }
  },
);

// Delete gift card (only if no redemptions reference it; otherwise deactivate)
router.delete(
  '/gift-cards/:id',
  requireRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next) => {
    try {
      const { prisma } = await import('../../config/database.js');
      const id = req.params.id as string;
      const redemptionCount = await prisma.redemption.count({ where: { giftCardId: id } });
      if (redemptionCount > 0) {
        await prisma.giftCard.update({ where: { id }, data: { isActive: false } });
        res.json({ action: 'deactivated', message: 'Gift card has redemptions — deactivated instead of deleted' });
      } else {
        await prisma.giftCard.delete({ where: { id } });
        res.json({ action: 'deleted', message: 'Gift card deleted' });
      }
    } catch (err) {
      next(err);
    }
  },
);

// Create admin (super_admin only)
router.post(
  '/admins',
  requireRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next) => {
    try {
      const input = createAdminSchema.parse(req.body);
      const result = await createAdmin(input.email, input.password, input.name, input.role);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Force-reset a driver's password (super_admin only)
router.post(
  '/drivers/reset-password',
  requireRole('SUPER_ADMIN'),
  async (req: Request, res: Response, next) => {
    try {
      const { email, newPassword } = req.body as { email: string; newPassword: string };
      if (!email || !newPassword || newPassword.length < 8) {
        res.status(400).json({ error: 'email and newPassword (min 8 chars) are required' });
        return;
      }
      const result = await adminResetDriverPassword(email, newPassword, req.admin!.sub);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export { router as adminRouter };
