import { prisma } from '../config/database.js';
import { parseUberTripResponse } from '../services/uber-parser.js';
import { logger } from '../config/logger.js';

async function backfillTrips() {
  const trips = await prisma.trip.findMany({
    where: { rawPayload: { not: { equals: undefined } } },
    select: { id: true, tripUuid: true, rawPayload: true },
  });

  logger.info({ count: trips.length }, 'Backfill: re-parsing trips');

  let updated = 0;
  let errors = 0;

  for (const trip of trips) {
    try {
      const rawBody = JSON.stringify(trip.rawPayload);
      const parsed = parseUberTripResponse(rawBody, trip.tripUuid);
      if (!parsed) {
        errors++;
        continue;
      }

      await prisma.trip.update({
        where: { id: trip.id },
        data: {
          pickupLat: parsed.pickupLat,
          pickupLng: parsed.pickupLng,
          dropoffLat: parsed.dropoffLat,
          dropoffLng: parsed.dropoffLng,
          mapImageUrl: parsed.mapImageUrl,
          pickupDistrict: parsed.pickupDistrict,
          dropoffDistrict: parsed.dropoffDistrict,
          customerPayment: parsed.customerPayment || 0,
          uberServiceFee: parsed.uberServiceFee || 0,
          cashCollected: parsed.cashCollected || 0,
          tripBalance: parsed.tripBalance || 0,
          upfrontFare: parsed.upfrontFare || 0,
          commissionRate: parsed.commissionRate,
        },
      });
      updated++;
    } catch (e: any) {
      logger.error({ tripId: trip.id, err: e.message }, 'Backfill error');
      errors++;
    }
  }

  logger.info({ updated, errors }, 'Backfill complete');
  await prisma.$disconnect();
}

backfillTrips().catch((e) => {
  console.error(e);
  process.exit(1);
});
