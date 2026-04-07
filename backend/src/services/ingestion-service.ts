import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { calculateTripPoints } from './points-engine.js';
import { logger } from '../config/logger.js';
import { AppError } from '../api/middleware/error-handler.js';
import type { SubmitTripInput, SubmitActivityFeedInput } from '../api/validators/ingestion.js';
import type { Region } from '@prisma/client';

const MAX_TRIPS_PER_HOUR = 50;
const RAW_PAYLOAD_RETENTION_DAYS = 30;

async function checkVelocity(driverId: string): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.trip.count({
    where: {
      driverId,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (recentCount >= MAX_TRIPS_PER_HOUR) {
    throw new AppError(429, 'Too many trips submitted in the last hour', 'VELOCITY_LIMIT');
  }
}

function validateFarePlausibility(trip: SubmitTripInput, region: Region): void {
  const maxFare = region === 'HK' ? 5000 : 10000;  // HKD / BRL
  if (trip.fareAmount > maxFare) {
    throw new AppError(422, 'Fare amount exceeds plausible range', 'IMPLAUSIBLE_FARE');
  }

  if (trip.netEarnings > trip.fareAmount) {
    throw new AppError(422, 'Net earnings cannot exceed fare amount', 'INVALID_EARNINGS');
  }

  const requestedDate = new Date(trip.requestedAt * 1000);
  const now = new Date();
  const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());

  if (requestedDate > now || requestedDate < threeYearsAgo) {
    throw new AppError(422, 'Trip timestamp out of acceptable range', 'INVALID_TIMESTAMP');
  }
}

export async function submitTrip(
  driverId: string,
  region: Region,
  input: SubmitTripInput,
): Promise<{ tripId: string; pointsAwarded: number; isDuplicate: boolean }> {
  await checkVelocity(driverId);
  validateFarePlausibility(input, region);

  const existing = await prisma.trip.findUnique({
    where: { driverId_tripUuid: { driverId, tripUuid: input.tripUuid } },
    select: { id: true, payloadHash: true, pointsAwarded: true },
  });

  if (existing) {
    if (existing.payloadHash !== input.rawPayloadHash) {
      logger.warn(
        { driverId, tripUuid: input.tripUuid },
        'Duplicate trip with different payload hash — possible tampering',
      );
    }
    return { tripId: existing.id, pointsAwarded: existing.pointsAwarded, isDuplicate: true };
  }

  const pointsAwarded = calculateTripPoints({
    netEarnings: new Decimal(input.netEarnings),
    region,
    isSurge: input.isSurge,
    vehicleType: input.vehicleType ?? null,
  });

  const trip = await prisma.$transaction(async (tx) => {
    const t = await tx.trip.create({
      data: {
        driverId,
        tripUuid: input.tripUuid,
        region,
        vehicleType: input.vehicleType,
        requestedAt: new Date(input.requestedAt * 1000),
        durationSeconds: input.durationSeconds,
        distanceMeters: input.distanceMeters,
        pickupDistrict: input.pickupDistrict,
        dropoffDistrict: input.dropoffDistrict,
        currency: input.currency,
        fareAmount: input.fareAmount,
        serviceFee: input.serviceFee,
        bookingFee: input.bookingFee,
        tolls: input.tolls,
        tips: input.tips,
        netEarnings: input.netEarnings,
        isPoolType: input.isPoolType,
        isSurge: input.isSurge,
        uberPoints: input.uberPoints,
        payloadHash: input.rawPayloadHash,
        rawPayloadPurgeAt: new Date(Date.now() + RAW_PAYLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        pointsAwarded,
        processedAt: new Date(),
      },
    });

    if (pointsAwarded > 0) {
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: driverId },
        select: { pointsBalance: true },
      });

      const newBalance = driver.pointsBalance + pointsAwarded;

      await tx.pointLedger.create({
        data: {
          driverId,
          tripId: t.id,
          amount: pointsAwarded,
          balance: newBalance,
          type: 'trip_earn',
          description: `Trip ${input.tripUuid.slice(0, 8)}... — ${input.vehicleType ?? 'ride'}`,
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

    return t;
  });

  logger.info(
    { driverId, tripId: trip.id, tripUuid: input.tripUuid, pointsAwarded },
    'Trip submitted and processed',
  );

  return { tripId: trip.id, pointsAwarded, isDuplicate: false };
}

export async function submitActivityFeed(
  driverId: string,
  region: Region,
  input: SubmitActivityFeedInput,
) {
  const tripUuids = input.trips
    .filter((t) => t.type === 'TRIP')
    .map((t) => t.uuid);

  const existingTrips = await prisma.trip.findMany({
    where: {
      driverId,
      tripUuid: { in: tripUuids },
    },
    select: { tripUuid: true },
  });

  const existingSet = new Set(existingTrips.map((t) => t.tripUuid));
  const newTripUuids = tripUuids.filter((uuid) => !existingSet.has(uuid));

  await prisma.activitySync.create({
    data: {
      driverId,
      region,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      tripCount: tripUuids.length,
      source: input.source,
    },
  });

  return {
    totalTrips: tripUuids.length,
    alreadySubmitted: existingSet.size,
    newTripsToFetch: newTripUuids,
  };
}
