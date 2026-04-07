import { prisma } from '../src/config/database.js';
import { parseUberTripResponse } from '../src/services/uber-parser.js';

async function main() {
  const trips = await prisma.trip.findMany({
    where: { rawPayload: { not: undefined } },
    select: { id: true, tripUuid: true, rawPayload: true },
  });

  console.log(`Found ${trips.length} trips to re-parse`);

  for (const trip of trips) {
    if (!trip.rawPayload) continue;

    const rawBody = JSON.stringify(trip.rawPayload);
    const parsed = parseUberTripResponse(rawBody, trip.tripUuid);

    if (!parsed) {
      console.log(`  SKIP ${trip.tripUuid} — parse returned null`);
      continue;
    }

    await prisma.trip.update({
      where: { id: trip.id },
      data: {
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
        tripNotes: parsed.tripNotes,
        statusType: parsed.statusType,
        pickupAddress: parsed.pickupAddress,
        dropoffAddress: parsed.dropoffAddress,
        pickupDistrict: parsed.pickupDistrict,
        dropoffDistrict: parsed.dropoffDistrict,
        pickupLat: parsed.pickupLat,
        pickupLng: parsed.pickupLng,
        dropoffLat: parsed.dropoffLat,
        dropoffLng: parsed.dropoffLng,
        mapImageUrl: parsed.mapImageUrl,
        durationSeconds: parsed.durationSeconds,
        distanceMeters: parsed.distanceMeters,
        uberPoints: parsed.uberPoints,
      },
    });

    console.log(`  OK ${trip.tripUuid}: fare=${parsed.fareAmount} net=${parsed.netEarnings} tolls=${parsed.tolls} notes=${parsed.tripNotes || '—'} breakdown_items=${parsed.fareBreakdown.length}`);
  }

  console.log('Done!');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
