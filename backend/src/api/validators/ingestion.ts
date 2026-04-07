import { z } from 'zod';

export const submitTripSchema = z.object({
  tripUuid: z.string().uuid(),
  vehicleType: z.string().max(50).optional(),
  requestedAt: z.number().int().positive(),  // unix timestamp
  durationSeconds: z.number().int().nonnegative().optional(),
  distanceMeters: z.number().int().nonnegative().optional(),
  pickupDistrict: z.string().max(100).optional(),
  dropoffDistrict: z.string().max(100).optional(),
  currency: z.string().length(3),

  fareAmount: z.number().min(0),
  serviceFee: z.number().default(0),
  bookingFee: z.number().default(0),
  tolls: z.number().default(0),
  tips: z.number().default(0),
  netEarnings: z.number(),

  isPoolType: z.boolean().default(false),
  isSurge: z.boolean().default(false),
  uberPoints: z.number().int().optional(),

  rawPayloadHash: z.string().length(64),
});

export const submitActivityFeedSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trips: z.array(
    z.object({
      uuid: z.string().uuid(),
      activityTitle: z.string().max(100),
      formattedTotal: z.string().max(50),
      type: z.string().max(30),
    }),
  ),
  source: z.enum(['chrome_extension', 'android_app']),
});

export const submitBatchTripsSchema = z.object({
  trips: z.array(submitTripSchema).min(1).max(100),
  source: z.enum(['chrome_extension', 'android_app']),
});

export type SubmitTripInput = z.infer<typeof submitTripSchema>;
export type SubmitActivityFeedInput = z.infer<typeof submitActivityFeedSchema>;
export type SubmitBatchTripsInput = z.infer<typeof submitBatchTripsSchema>;
