import type { Region } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Points system:
 *   - 1 point per qualified completed trip
 *   - ~50 points ≈ 1 USD in gift card value
 *   - Qualified = completed (not cancelled), within the last 30 days
 *
 * This function is kept for backward compatibility with the /api/ingest/trips
 * endpoint (pre-parsed trips). The raw-trips endpoint calculates points directly.
 */

interface TripForPoints {
  netEarnings: Decimal;
  region: Region;
  isSurge: boolean;
  vehicleType: string | null;
}

export function calculateTripPoints(_trip: TripForPoints): number {
  return 1;
}

export const POINTS_PER_USD = 50;
export const POINTS_PER_TRIP = 1;
