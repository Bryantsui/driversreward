import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { submitBatchTripsSchema, submitActivityFeedSchema } from '../validators/ingestion.js';
import { submitTrip, submitActivityFeed } from '../../services/ingestion-service.js';
import { parseUberTripResponse } from '../../services/uber-parser.js';
import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { getSyncWindow } from '../../utils/sync-window.js';
import type { Region } from '@prisma/client';

const router = Router();

router.use(authenticate);

// --- Existing endpoint: pre-parsed trips ---
router.post('/trips', async (req: Request, res: Response, next) => {
  try {
    const input = submitBatchTripsSchema.parse(req.body);
    const driverId = req.driver!.sub;
    const region = req.driver!.region as Region;

    const results = [];
    for (const trip of input.trips) {
      const result = await submitTrip(driverId, region, trip);
      results.push(result);
    }

    const totalPoints = results.reduce((sum, r) => sum + (r.isDuplicate ? 0 : r.pointsAwarded), 0);
    const newTrips = results.filter((r) => !r.isDuplicate).length;
    const duplicates = results.filter((r) => r.isDuplicate).length;

    res.status(201).json({
      processed: results.length,
      newTrips,
      duplicates,
      totalPointsAwarded: totalPoints,
      trips: results,
    });
  } catch (err) {
    next(err);
  }
});

// --- New endpoint: raw Uber responses (server-side parsing) ---
const rawTripsSchema = z.object({
  trips: z.array(z.object({
    rawBody: z.string().min(10).max(500_000),
    tripUuid: z.string().max(100).optional(),
    url: z.string().max(500).optional(),
  })).min(1).max(100),
  source: z.enum(['chrome_extension', 'android_app']),
});

router.post('/raw-trips', async (req: Request, res: Response, next) => {
  try {
    const input = rawTripsSchema.parse(req.body);
    const driverId = req.driver!.sub;
    const region = req.driver!.region as Region;

    const { inWindow: windowEligible } = getSyncWindow(region);

    const results: Array<{
      tripUuid: string;
      status: 'created' | 'duplicate' | 'parse_error' | 'validation_error';
      pointsAwarded: number;
      windowEligible: boolean;
      error?: string;
    }> = [];

    // Pre-parse all trips to collect UUIDs for batch dedup
    const parsedTrips = input.trips.map(({ rawBody, tripUuid: inputUuid }) => ({
      rawBody,
      parsed: parseUberTripResponse(rawBody, inputUuid || ''),
    }));
    const allUuids = parsedTrips
      .map((t) => t.parsed?.tripUuid)
      .filter((u): u is string => !!u);

    // Batch dedup: fetch all existing trips for this driver in one query
    const existingOwn = allUuids.length > 0
      ? await prisma.trip.findMany({
          where: { driverId, tripUuid: { in: allUuids } },
          select: { tripUuid: true, pointsAwarded: true },
        })
      : [];
    const ownDupeMap = new Map(existingOwn.map((t) => [t.tripUuid, t.pointsAwarded]));

    // Batch cross-driver dedup
    const remainingUuids = allUuids.filter((u) => !ownDupeMap.has(u));
    const crossDriverDupes = remainingUuids.length > 0
      ? await prisma.trip.findMany({
          where: { tripUuid: { in: remainingUuids }, driverId: { not: driverId } },
          select: { tripUuid: true, driverId: true },
        })
      : [];
    const crossDupeSet = new Set(crossDriverDupes.map((t) => t.tripUuid));

    for (const { rawBody, parsed } of parsedTrips) {
      if (!parsed) {
        results.push({ tripUuid: '', status: 'parse_error', pointsAwarded: 0, windowEligible, error: 'Could not parse Uber response' });
        continue;
      }

      // Same-driver duplicate
      if (ownDupeMap.has(parsed.tripUuid)) {
        results.push({ tripUuid: parsed.tripUuid, status: 'duplicate', pointsAwarded: ownDupeMap.get(parsed.tripUuid) ?? 0, windowEligible });
        continue;
      }

      // Cross-driver fraud check
      if (crossDupeSet.has(parsed.tripUuid)) {
        logger.warn({ tripUuid: parsed.tripUuid, driverId }, 'Cross-driver duplicate detected — possible fraud');
        results.push({ tripUuid: parsed.tripUuid, status: 'validation_error', pointsAwarded: 0, windowEligible, error: 'This trip has already been submitted by another account' });
        continue;
      }

      // Validate timestamp
      const requestedDate = new Date(parsed.requestedAt * 1000);
      const now = new Date();
      const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
      if (requestedDate > now || requestedDate < threeYearsAgo) {
        results.push({ tripUuid: parsed.tripUuid, status: 'validation_error', pointsAwarded: 0, windowEligible, error: 'Timestamp out of range' });
        continue;
      }

      try {
        const isCancelled = parsed.statusType && parsed.statusType.toUpperCase().includes('CANCEL');
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const isWithin30Days = requestedDate >= thirtyDaysAgo;
        const { inWindow } = getSyncWindow(region);
        const isQualified = !isCancelled && isWithin30Days && parsed.parseConfidence !== 'low' && inWindow;

        const pointsAwarded = isQualified ? 1 : 0;

        // Auto-flag trips with parse integrity issues
        const autoFlagged = parsed.parseConfidence === 'low';
        const autoFlagReason = autoFlagged
          ? `Auto-flagged: low parse confidence. Warnings: ${parsed.parseWarnings.join('; ')}`
          : (parsed.parseConfidence === 'medium'
            ? `Parse warnings: ${parsed.parseWarnings.join('; ')}`
            : undefined);

        await prisma.$transaction(async (tx) => {
          const trip = await tx.trip.create({
            data: {
              driverId,
              tripUuid: parsed.tripUuid,
              region,
              vehicleType: parsed.vehicleType,
              requestedAt: requestedDate,
              durationSeconds: parsed.durationSeconds,
              distanceMeters: parsed.distanceMeters,
              currency: parsed.currency,
              pickupAddress: parsed.pickupAddress,
              dropoffAddress: parsed.dropoffAddress,
              pickupDistrict: parsed.pickupDistrict,
              dropoffDistrict: parsed.dropoffDistrict,
              pickupLat: parsed.pickupLat,
              pickupLng: parsed.pickupLng,
              dropoffLat: parsed.dropoffLat,
              dropoffLng: parsed.dropoffLng,
              mapImageUrl: parsed.mapImageUrl,
              fareAmount: parsed.fareAmount,
              serviceFee: parsed.serviceFee,
              serviceFeePercent: parsed.serviceFeePercent,
              bookingFee: parsed.bookingFee,
              bookingFeePayment: parsed.bookingFeePayment,
              otherEarnings: parsed.otherEarnings,
              tolls: parsed.tolls,
              tips: parsed.tips,
              surcharges: parsed.surcharges,
              promotions: parsed.promotions,
              netEarnings: parsed.netEarnings,
              fareBreakdown: parsed.fareBreakdown as any,
              isPoolType: parsed.isPoolType,
              isSurge: parsed.isSurge,
              uberPoints: parsed.uberPoints,
              dateRequested: parsed.dateRequested,
              timeRequested: parsed.timeRequested,
              tripNotes: parsed.tripNotes,
              statusType: parsed.statusType,
              payloadHash: parsed.rawPayloadHash,
              rawPayload: JSON.parse(rawBody),
              rawPayloadPurgeAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
              source: input.source,
              pointsAwarded,
              processedAt: new Date(),
              // Auto-flag if parse confidence is low
              reviewStatus: autoFlagged ? 'FLAGGED' : 'PENDING_REVIEW',
              flagReason: autoFlagReason,
            },
          });

          if (pointsAwarded > 0) {
            const driver = await tx.driver.findUniqueOrThrow({
              where: { id: driverId },
              select: { pointsBalance: true },
            });

            await tx.pointLedger.create({
              data: {
                driverId,
                tripId: trip.id,
                amount: pointsAwarded,
                balance: driver.pointsBalance + pointsAwarded,
                type: 'trip_earn',
                description: `Trip ${parsed.tripUuid.slice(0, 8)}... — ${parsed.vehicleType ?? 'ride'}`,
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
              },
            });

            await tx.driver.update({
              where: { id: driverId },
              data: {
                pointsBalance: { increment: pointsAwarded },
                lifetimePoints: { increment: pointsAwarded },
                lastActiveAt: new Date(),
              },
            });
          }
        });

        results.push({ tripUuid: parsed.tripUuid, status: 'created', pointsAwarded, windowEligible });
        logger.info({ driverId, tripUuid: parsed.tripUuid, pointsAwarded, windowEligible }, 'Raw trip ingested');
      } catch (err: any) {
        logger.error({ err, tripUuid: parsed.tripUuid }, 'Failed to store trip');
        results.push({ tripUuid: parsed.tripUuid, status: 'validation_error', pointsAwarded: 0, windowEligible, error: err.message });
      }
    }

    const created = results.filter((r) => r.status === 'created');
    const totalPoints = created.reduce((s, r) => s + r.pointsAwarded, 0);

    res.status(201).json({
      processed: results.length,
      created: created.length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      errors: results.filter((r) => r.status === 'parse_error' || r.status === 'validation_error').length,
      totalPointsAwarded: totalPoints,
      windowEligible,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// --- New endpoint: bonus/quest activities from activity feed ---
const rawBonusesSchema = z.object({
  bonuses: z.array(z.object({
    uuid: z.string().max(100),
    activityType: z.string().max(50),
    activityTitle: z.string().max(200),
    formattedTotal: z.string().max(50),
    recognizedAt: z.number(),
    formattedDate: z.string().max(100).optional(),
    description: z.string().max(2000).optional(),
    eventType: z.string().max(50).optional(),
    incentiveUuid: z.string().max(100).optional(),
    rawPayload: z.any().optional(),
  })).min(1).max(500),
  source: z.enum(['chrome_extension', 'android_app']),
});

router.post('/raw-bonuses', async (req: Request, res: Response, next) => {
  try {
    const input = rawBonusesSchema.parse(req.body);
    const driverId = req.driver!.sub;
    const region = req.driver!.region as Region;

    const allUuids = input.bonuses.map((b) => b.uuid);
    const existing = await prisma.earningsBonus.findMany({
      where: { driverId, bonusUuid: { in: allUuids } },
      select: { bonusUuid: true },
    });
    const existingSet = new Set(existing.map((e) => e.bonusUuid));

    let created = 0;
    let duplicates = 0;

    for (const bonus of input.bonuses) {
      if (existingSet.has(bonus.uuid)) {
        duplicates++;
        continue;
      }

      const amountStr = bonus.formattedTotal.replace(/[^0-9.\-]/g, '');
      const amount = parseFloat(amountStr) || 0;
      const currency = bonus.formattedTotal.includes('HK$') ? 'HKD'
        : bonus.formattedTotal.includes('R$') ? 'BRL'
        : 'USD';

      try {
        await prisma.earningsBonus.create({
          data: {
            driverId,
            bonusUuid: bonus.uuid,
            region,
            activityType: bonus.activityType,
            activityTitle: bonus.activityTitle,
            formattedTotal: bonus.formattedTotal,
            amount,
            currency,
            recognizedAt: new Date(bonus.recognizedAt * 1000),
            formattedDate: bonus.formattedDate || undefined,
            description: bonus.description || undefined,
            eventType: bonus.eventType || undefined,
            incentiveUuid: bonus.incentiveUuid || undefined,
            source: input.source,
            rawPayload: bonus.rawPayload || undefined,
          },
        });
        created++;
        existingSet.add(bonus.uuid);
      } catch (err: any) {
        if (err.code === 'P2002') {
          duplicates++;
        } else {
          logger.error({ err, bonusUuid: bonus.uuid }, 'Failed to store bonus');
        }
      }
    }

    logger.info({ driverId, created, duplicates, total: input.bonuses.length }, 'Bonuses ingested');

    res.status(201).json({
      processed: input.bonuses.length,
      created,
      duplicates,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/activity-feed', async (req: Request, res: Response, next) => {
  try {
    const input = submitActivityFeedSchema.parse(req.body);
    const driverId = req.driver!.sub;
    const region = req.driver!.region as Region;

    const result = await submitActivityFeed(driverId, region, input);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { router as ingestionRouter };
