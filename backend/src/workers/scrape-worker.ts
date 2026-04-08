import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { decrypt } from '../utils/encryption.js';
import { getProxy, proxyToUrl } from '../services/proxy-manager.js';
import { scrapeDriverTrips, type UberSessionData } from '../services/uber-scraper.js';
import { parseUberTripResponse } from '../services/uber-parser.js';
import { getSyncWindow } from '../utils/sync-window.js';
import type { Region } from '@prisma/client';

const QUEUE_NAME = 'scrape-trips';

const queueConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const workerConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const scrapeQueue = new Queue(QUEUE_NAME, { connection: queueConnection });

// Circuit breaker: track regional failures in Redis for persistence
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_S = 6 * 60 * 60; // 6 hours

async function isRegionPaused(region: string): Promise<boolean> {
  const pausedUntil = await queueConnection.get(`cb:paused:${region}`);
  if (!pausedUntil) return false;
  if (Date.now() > parseInt(pausedUntil, 10)) {
    await queueConnection.del(`cb:paused:${region}`, `cb:fails:${region}`);
    return false;
  }
  return true;
}

async function recordRegionFailure(region: string): Promise<void> {
  const key = `cb:fails:${region}`;
  const count = await queueConnection.incr(key);
  await queueConnection.expire(key, CIRCUIT_BREAKER_COOLDOWN_S);

  if (count >= CIRCUIT_BREAKER_THRESHOLD) {
    const pausedUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_S * 1000;
    await queueConnection.set(`cb:paused:${region}`, String(pausedUntil), 'EX', CIRCUIT_BREAKER_COOLDOWN_S);
    logger.warn({ region, cooldownHours: CIRCUIT_BREAKER_COOLDOWN_S / 3600 }, 'Circuit breaker tripped — pausing region');
  }
}

async function processScrapeJob(jobData: { driverId: string; trigger: string; scrapeJobId: string }) {
  const { driverId, trigger, scrapeJobId } = jobData;
  const log = logger.child({ driverId, scrapeJobId, trigger });

  // Update job status to running
  await prisma.scrapeJob.update({
    where: { id: scrapeJobId },
    data: { status: 'running', startedAt: new Date() },
  });

  try {
    // Load credential
    const credential = await prisma.uberCredential.findUnique({ where: { driverId } });
    if (!credential || !credential.isValid) {
      log.warn('No valid credential found');
      await prisma.scrapeJob.update({
        where: { id: scrapeJobId },
        data: { status: 'session_expired', errorMessage: 'No valid session credential', completedAt: new Date() },
      });
      return;
    }

    const region = credential.region;
    if (await isRegionPaused(region)) {
      log.warn({ region }, 'Region is paused by circuit breaker, skipping');
      await prisma.scrapeJob.update({
        where: { id: scrapeJobId },
        data: { status: 'failed', errorMessage: 'Region paused by circuit breaker', completedAt: new Date() },
      });
      return;
    }

    // Decrypt session data
    let session: UberSessionData;
    try {
      session = {
        cookies: decrypt(credential.cookiesEncrypted),
        csrfToken: decrypt(credential.csrfEncrypted),
        userAgent: credential.userAgent,
      };
    } catch (e: any) {
      log.error({ err: e }, 'Failed to decrypt credential');
      await prisma.scrapeJob.update({
        where: { id: scrapeJobId },
        data: { status: 'failed', errorMessage: `Decryption failed: ${e.message}`, completedAt: new Date() },
      });
      return;
    }

    // Get proxy with sticky session (use scrapeJobId for stickiness)
    const proxy = getProxy(region, scrapeJobId);
    const proxyIp = proxy ? `${proxy.host}:${proxy.port}` : 'direct';
    log.info({ proxyIp }, 'Starting scrape');

    // Run the scraper
    const scrapeResult = await scrapeDriverTrips(session, proxy);

    // Check for session expiration
    if (scrapeResult.errors.includes('SESSION_EXPIRED')) {
      log.warn('Session expired during scrape');
      await prisma.uberCredential.update({
        where: { driverId },
        data: { isValid: false, invalidReason: 'Session expired during scrape' },
      });
      await recordRegionFailure(region);
      await prisma.scrapeJob.update({
        where: { id: scrapeJobId },
        data: {
          status: 'session_expired',
          proxyIp,
          tripsFound: scrapeResult.tripsFound,
          errorMessage: 'Uber session expired',
          completedAt: new Date(),
        },
      });
      return;
    }

    // Update last-used timestamp on credential
    await prisma.uberCredential.update({
      where: { driverId },
      data: { lastUsedAt: new Date() },
    });

    // Ingest trips using the same logic as the raw-trips endpoint
    const { inWindow: windowEligible } = getSyncWindow(region);
    let totalPointsAwarded = 0;
    let tripsCreated = 0;

    // Pre-parse and batch dedup
    const parsedTrips = scrapeResult.tripResponses
      .map(({ rawBody, tripUuid }) => ({ rawBody, parsed: parseUberTripResponse(rawBody, tripUuid) }))
      .filter((t): t is { rawBody: string; parsed: NonNullable<typeof t.parsed> } => !!t.parsed);

    const allUuids = parsedTrips.map((t) => t.parsed.tripUuid);
    const existingOwn = allUuids.length > 0
      ? await prisma.trip.findMany({ where: { driverId, tripUuid: { in: allUuids } }, select: { tripUuid: true } })
      : [];
    const ownDupeSet = new Set(existingOwn.map((t) => t.tripUuid));

    const remainingUuids = allUuids.filter((u) => !ownDupeSet.has(u));
    const crossDupes = remainingUuids.length > 0
      ? await prisma.trip.findMany({ where: { tripUuid: { in: remainingUuids }, driverId: { not: driverId } }, select: { tripUuid: true } })
      : [];
    const crossDupeSet = new Set(crossDupes.map((t) => t.tripUuid));

    for (const { rawBody, parsed } of parsedTrips) {
      if (ownDupeSet.has(parsed.tripUuid)) continue;
      if (crossDupeSet.has(parsed.tripUuid)) {
        log.warn({ tripUuid: parsed.tripUuid }, 'Cross-driver duplicate — skipping');
        continue;
      }

      // Validate timestamp
      const requestedDate = new Date(parsed.requestedAt * 1000);
      const now = new Date();
      const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
      if (requestedDate > now || requestedDate < threeYearsAgo) continue;

      const isCancelled = parsed.statusType?.toUpperCase().includes('CANCEL');
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const isWithin30Days = requestedDate >= thirtyDaysAgo;
      const isQualified = !isCancelled && isWithin30Days && parsed.parseConfidence !== 'low' && windowEligible;
      const pointsAwarded = isQualified ? 1 : 0;

      const autoFlagged = parsed.parseConfidence === 'low';

      try {
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
              source: 'server_scrape',
              pointsAwarded,
              processedAt: new Date(),
              reviewStatus: autoFlagged ? 'FLAGGED' : 'PENDING_REVIEW',
              flagReason: autoFlagged
                ? `Auto-flagged: low parse confidence. Warnings: ${parsed.parseWarnings.join('; ')}`
                : undefined,
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
                description: `Trip ${parsed.tripUuid.slice(0, 8)}... — ${parsed.vehicleType ?? 'ride'} (server)`,
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

        tripsCreated++;
        totalPointsAwarded += pointsAwarded;
      } catch (e: any) {
        log.error({ err: e, tripUuid: parsed.tripUuid }, 'Failed to ingest trip');
      }
    }

    // Finalize job
    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: {
        status: 'success',
        proxyIp,
        tripsFound: scrapeResult.tripsFound,
        pointsAwarded: totalPointsAwarded,
        completedAt: new Date(),
      },
    });

    log.info({ tripsFound: scrapeResult.tripsFound, tripsCreated, totalPointsAwarded }, 'Scrape job complete');
  } catch (e: any) {
    log.error({ err: e }, 'Scrape job failed');
    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: { status: 'failed', errorMessage: e.message?.slice(0, 1000), completedAt: new Date() },
    });
  }
}

export function startScrapeWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processScrapeJob(job.data);
    },
    {
      connection: workerConnection,
      concurrency: env.SCRAPE_CONCURRENCY,
      limiter: { max: 5, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Scrape worker job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Scrape worker job failed');
  });

  logger.info({ concurrency: env.SCRAPE_CONCURRENCY }, 'Scrape worker started');
  return worker;
}

/**
 * Enqueue a scrape job for a driver.
 */
export async function enqueueScrapeJob(
  driverId: string,
  trigger: 'cron' | 'manual',
  delayMs: number = 0,
): Promise<string> {
  const scrapeJob = await prisma.scrapeJob.create({
    data: { driverId, trigger, status: 'queued' },
  });

  await scrapeQueue.add(
    `scrape-${driverId}`,
    { driverId, trigger, scrapeJobId: scrapeJob.id },
    {
      delay: delayMs,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  );

  return scrapeJob.id;
}
