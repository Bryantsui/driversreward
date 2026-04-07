import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { signAdminToken } from '../utils/admin-jwt.js';
import { AppError } from '../api/middleware/error-handler.js';
import { logger } from '../config/logger.js';
import type { Region, TripReviewStatus } from '@prisma/client';

const SALT_ROUNDS = 12;

export async function adminLogin(email: string, password: string) {
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin || !admin.isActive) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  await prisma.admin.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const token = await signAdminToken(admin.id, admin.email, admin.role);

  logger.info({ adminId: admin.id, email: admin.email }, 'Admin login');

  return {
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    token,
  };
}

export async function createAdmin(email: string, password: string, name: string, role: string = 'REVIEWER') {
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, 'Admin email already exists', 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const admin = await prisma.admin.create({
    data: { email, passwordHash, name, role: role as any },
  });

  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
}

export interface DashboardFilters {
  region?: Region;
  reviewStatus?: TripReviewStatus;
  driverId?: string;
  dateFrom?: string;
  dateTo?: string;
  minFare?: number;
  maxFare?: number;
  page: number;
  limit: number;
}

async function regionStats(region?: Region) {
  const driverWhere: any = { deletedAt: null };
  const tripWhere: any = {};
  if (region) {
    driverWhere.region = region;
    tripWhere.region = region;
  }

  const activeWhere = { ...driverWhere, lastActiveAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } };

  const [
    totalDrivers, activeDrivers,
    totalTrips, pendingReviewTrips, flaggedTrips, approvedTrips, rejectedTrips,
    totalPointsIssued, totalRedemptions, activeSessions,
    totalEarnings,
  ] = await Promise.all([
    prisma.driver.count({ where: driverWhere }),
    prisma.driver.count({ where: activeWhere }),
    prisma.trip.count({ where: tripWhere }),
    prisma.trip.count({ where: { ...tripWhere, reviewStatus: 'PENDING_REVIEW' } }),
    prisma.trip.count({ where: { ...tripWhere, reviewStatus: 'FLAGGED' } }),
    prisma.trip.count({ where: { ...tripWhere, reviewStatus: 'APPROVED' } }),
    prisma.trip.count({ where: { ...tripWhere, reviewStatus: 'REJECTED' } }),
    prisma.pointLedger.aggregate({
      where: { type: 'trip_earn', ...(region ? { driver: { region } } : {}) },
      _sum: { amount: true },
    }),
    prisma.redemption.count({ where: region ? { driver: { region } } : {} }),
    prisma.uberSession.count({
      where: {
        isActive: true,
        lastHeartbeat: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        ...(region ? { driver: { region } } : {}),
      },
    }),
    prisma.trip.aggregate({
      where: tripWhere,
      _sum: { netEarnings: true },
    }),
  ]);

  return {
    drivers: { total: totalDrivers, activeThisWeek: activeDrivers },
    trips: { total: totalTrips, pendingReview: pendingReviewTrips, flagged: flaggedTrips, approved: approvedTrips, rejected: rejectedTrips },
    points: { totalIssued: totalPointsIssued._sum.amount ?? 0 },
    redemptions: { total: totalRedemptions },
    sessions: { activeNow: activeSessions },
    earnings: { total: totalEarnings._sum.netEarnings?.toNumber() ?? 0 },
  };
}

export async function getDashboardOverview() {
  return regionStats();
}

export async function getDashboardOverviewByRegion() {
  const [all, hk, br] = await Promise.all([
    regionStats(),
    regionStats('HK'),
    regionStats('BR'),
  ]);
  return { all, HK: hk, BR: br };
}

export async function getDriversList(filters: { region?: Region; status?: string; page: number; limit: number }) {
  const where: any = { deletedAt: null };
  if (filters.region) where.region = filters.region;
  if (filters.status) where.status = filters.status;

  const [drivers, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      select: {
        id: true,
        email: true,
        region: true,
        status: true,
        pointsBalance: true,
        lifetimePoints: true,
        lastActiveAt: true,
        createdAt: true,
        _count: { select: { trips: true, redemptions: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.driver.count({ where }),
  ]);

  return { drivers, total, page: filters.page, limit: filters.limit };
}

export async function getTripsForReview(filters: DashboardFilters) {
  const where: any = {};
  if (filters.region) where.region = filters.region;
  if (filters.reviewStatus) where.reviewStatus = filters.reviewStatus;
  if (filters.driverId) where.driverId = filters.driverId;
  if (filters.dateFrom || filters.dateTo) {
    where.requestedAt = {};
    if (filters.dateFrom) where.requestedAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.requestedAt.lte = new Date(filters.dateTo);
  }
  if (filters.minFare || filters.maxFare) {
    where.fareAmount = {};
    if (filters.minFare) where.fareAmount.gte = filters.minFare;
    if (filters.maxFare) where.fareAmount.lte = filters.maxFare;
  }

  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where,
      include: {
        driver: { select: { id: true, email: true, region: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.trip.count({ where }),
  ]);

  return { trips, total, page: filters.page, limit: filters.limit };
}

export async function reviewTrip(
  tripId: string,
  adminId: string,
  action: 'APPROVED' | 'FLAGGED' | 'REJECTED',
  note?: string,
) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new AppError(404, 'Trip not found', 'TRIP_NOT_FOUND');
  }

  const previousStatus = trip.reviewStatus;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.trip.update({
      where: { id: tripId },
      data: {
        reviewStatus: action,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        reviewNote: note,
        flagReason: action === 'FLAGGED' || action === 'REJECTED' ? note : null,
      },
    });

    // Clawback: deduct points when rejecting a trip (only if not already rejected)
    if (action === 'REJECTED' && previousStatus !== 'REJECTED' && trip.pointsAwarded > 0) {
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: trip.driverId },
        select: { pointsBalance: true },
      });

      const deduction = Math.min(trip.pointsAwarded, driver.pointsBalance);
      if (deduction > 0) {
        const newBalance = driver.pointsBalance - deduction;

        await tx.pointLedger.create({
          data: {
            driverId: trip.driverId,
            tripId: trip.id,
            amount: -deduction,
            balance: newBalance,
            type: 'adjustment',
            description: `Trip rejected by admin: ${note || 'no reason given'}`,
          },
        });

        await tx.driver.update({
          where: { id: trip.driverId },
          data: { pointsBalance: { decrement: deduction } },
        });
      }
    }

    // Restore: re-credit points when un-rejecting a previously rejected trip
    if (previousStatus === 'REJECTED' && action !== 'REJECTED' && trip.pointsAwarded > 0) {
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: trip.driverId },
        select: { pointsBalance: true },
      });

      const newBalance = driver.pointsBalance + trip.pointsAwarded;

      await tx.pointLedger.create({
        data: {
          driverId: trip.driverId,
          tripId: trip.id,
          amount: trip.pointsAwarded,
          balance: newBalance,
          type: 'adjustment',
          description: `Trip un-rejected by admin (now ${action}): points restored`,
        },
      });

      await tx.driver.update({
        where: { id: trip.driverId },
        data: { pointsBalance: { increment: trip.pointsAwarded } },
      });
    }

    await tx.auditLog.create({
      data: {
        adminId,
        driverId: trip.driverId,
        action: `TRIP_${action}`,
        resource: 'trip',
        resourceId: tripId,
        details: { reviewStatus: action, previousStatus, note },
      },
    });

    return t;
  });

  logger.info({ tripId, adminId, action }, 'Trip reviewed');
  return updated;
}

export async function bulkReviewTrips(
  tripIds: string[],
  adminId: string,
  action: 'APPROVED' | 'FLAGGED' | 'REJECTED',
  note?: string,
) {
  const results = [];
  for (const tripId of tripIds) {
    try {
      const result = await reviewTrip(tripId, adminId, action, note);
      results.push({ tripId, success: true, status: result.reviewStatus });
    } catch (err: any) {
      results.push({ tripId, success: false, error: err.message });
    }
  }
  return results;
}

export async function getDriverDetail(driverId: string) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      email: true,
      region: true,
      status: true,
      pointsBalance: true,
      lifetimePoints: true,
      referralCode: true,
      emailVerified: true,
      lastActiveAt: true,
      createdAt: true,
      _count: {
        select: {
          trips: true,
          redemptions: true,
          activitySyncs: true,
        },
      },
    },
  });

  if (!driver) {
    throw new AppError(404, 'Driver not found', 'DRIVER_NOT_FOUND');
  }

  const tripStats = await prisma.trip.groupBy({
    by: ['reviewStatus'],
    where: { driverId },
    _count: true,
  });

  const recentSyncs = await prisma.activitySync.findMany({
    where: { driverId },
    orderBy: { syncedAt: 'desc' },
    take: 10,
  });

  const activeSession = await prisma.uberSession.findFirst({
    where: { driverId, isActive: true },
    orderBy: { lastHeartbeat: 'desc' },
  });

  const weeklyContribution = await prisma.trip.count({
    where: {
      driverId,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  return {
    driver,
    tripStats: Object.fromEntries(tripStats.map((s) => [s.reviewStatus, s._count])),
    recentSyncs,
    activeSession,
    weeklyContribution,
  };
}

export async function getSessionHealth() {
  const sessions = await prisma.uberSession.findMany({
    where: { isActive: true },
    include: {
      driver: { select: { id: true, email: true, region: true } },
    },
    orderBy: { lastHeartbeat: 'desc' },
  });

  const now = Date.now();
  return sessions.map((s) => {
    const minutesSinceHeartbeat = Math.floor((now - s.lastHeartbeat.getTime()) / 60_000);
    return {
      ...s,
      minutesSinceHeartbeat,
      health: minutesSinceHeartbeat < 5 ? 'healthy' : minutesSinceHeartbeat < 30 ? 'stale' : 'dead',
    };
  });
}

export async function getDriverPointLedger(driverId: string, page: number = 1, limit: number = 50) {
  const offset = (page - 1) * limit;
  const [entries, total] = await Promise.all([
    prisma.pointLedger.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      include: {
        trip: { select: { id: true, tripUuid: true, vehicleType: true, dateRequested: true } },
      },
    }),
    prisma.pointLedger.count({ where: { driverId } }),
  ]);
  return { entries, total, page, limit };
}

export async function getAllRedemptions(filters: {
  region?: Region;
  status?: string;
  driverId?: string;
  page: number;
  limit: number;
}) {
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.driverId) where.driverId = filters.driverId;
  if (filters.region) where.driver = { region: filters.region };

  const [redemptions, total] = await Promise.all([
    prisma.redemption.findMany({
      where,
      include: {
        driver: { select: { id: true, email: true, region: true } },
        giftCard: { select: { id: true, name: true, provider: true, faceValue: true, currency: true, pointsCost: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.redemption.count({ where }),
  ]);

  return { redemptions, total, page: filters.page, limit: filters.limit };
}

export async function fulfillRedemption(
  redemptionId: string,
  adminId: string,
  giftCardCode: string,
) {
  const redemption = await prisma.redemption.findUnique({
    where: { id: redemptionId },
    include: { giftCard: true },
  });
  if (!redemption) throw new AppError(404, 'Redemption not found', 'NOT_FOUND');
  if (redemption.status !== 'PENDING' && redemption.status !== 'PROCESSING') {
    throw new AppError(409, `Cannot fulfill redemption in ${redemption.status} state`, 'INVALID_STATE');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.redemption.update({
      where: { id: redemptionId },
      data: {
        status: 'FULFILLED',
        giftCardCode,
        fulfilledAt: new Date(),
        confirmedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        adminId,
        driverId: redemption.driverId,
        action: 'FULFILL_REDEMPTION',
        resource: 'redemption',
        resourceId: redemptionId,
        details: { giftCardName: redemption.giftCard.name, pointsSpent: redemption.pointsSpent },
      },
    });

    return r;
  });

  logger.info({ redemptionId, adminId }, 'Redemption fulfilled');
  return updated;
}

export async function cancelRedemption(
  redemptionId: string,
  adminId: string,
  reason: string,
) {
  const redemption = await prisma.redemption.findUnique({
    where: { id: redemptionId },
    include: { giftCard: true },
  });
  if (!redemption) throw new AppError(404, 'Redemption not found', 'NOT_FOUND');
  if (redemption.status === 'FULFILLED' || redemption.status === 'CANCELLED') {
    throw new AppError(409, `Cannot cancel redemption in ${redemption.status} state`, 'INVALID_STATE');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.redemption.update({
      where: { id: redemptionId },
      data: {
        status: 'CANCELLED',
        failureReason: reason,
      },
    });

    // Refund points
    const driver = await tx.driver.findUniqueOrThrow({
      where: { id: redemption.driverId },
      select: { pointsBalance: true },
    });

    const newBalance = driver.pointsBalance + redemption.pointsSpent;

    await tx.pointLedger.create({
      data: {
        driverId: redemption.driverId,
        amount: redemption.pointsSpent,
        balance: newBalance,
        type: 'adjustment',
        description: `Redemption cancelled: ${reason}. Points refunded.`,
      },
    });

    await tx.driver.update({
      where: { id: redemption.driverId },
      data: { pointsBalance: { increment: redemption.pointsSpent } },
    });

    // Restock the gift card
    await tx.giftCard.update({
      where: { id: redemption.giftCardId },
      data: { stockCount: { increment: 1 } },
    });

    await tx.auditLog.create({
      data: {
        adminId,
        driverId: redemption.driverId,
        action: 'CANCEL_REDEMPTION',
        resource: 'redemption',
        resourceId: redemptionId,
        details: { reason, pointsRefunded: redemption.pointsSpent },
      },
    });

    return r;
  });

  logger.info({ redemptionId, adminId, reason }, 'Redemption cancelled, points refunded');
  return updated;
}

export async function getGiftCardList() {
  return prisma.giftCard.findMany({
    orderBy: [{ region: 'asc' }, { pointsCost: 'asc' }],
    include: { _count: { select: { redemptions: true } } },
  });
}
