import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { enqueueScrapeJob } from '../workers/scrape-worker.js';
import { REGION_TZ } from '../utils/sync-window.js';
import type { Region } from '@prisma/client';

/**
 * Get the local hour for a region right now.
 */
function getLocalHour(region: Region): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REGION_TZ[region],
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
}

/**
 * Get the local day of week (0=Sunday, 1=Monday, ...) for a region.
 */
function getLocalDayOfWeek(region: Region): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REGION_TZ[region],
    weekday: 'short',
  }).formatToParts(new Date());
  const day = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[day] ?? 0;
}

/**
 * Enqueue scrape jobs for all drivers with valid credentials in a region.
 * Staggers each job by a random delay (0 to maxDelayMs) to avoid traffic bursts.
 */
async function enqueueRegionJobs(region: Region, maxDelayMs: number = 60 * 60 * 1000): Promise<number> {
  const credentials = await prisma.uberCredential.findMany({
    where: {
      region,
      isValid: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: { driverId: true },
  });

  if (credentials.length === 0) {
    logger.info({ region }, 'No valid credentials to scrape');
    return 0;
  }

  // Check for already-queued/running jobs in the last 24h to avoid double-scheduling
  const todayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existingJobs = await prisma.scrapeJob.findMany({
    where: {
      trigger: 'cron',
      createdAt: { gte: todayStart },
      status: { in: ['queued', 'running'] },
      driverId: { in: credentials.map((c) => c.driverId) },
    },
    select: { driverId: true },
  });
  const alreadyQueued = new Set(existingJobs.map((j) => j.driverId));

  let enqueued = 0;
  for (const cred of credentials) {
    if (alreadyQueued.has(cred.driverId)) continue;

    const delay = Math.floor(Math.random() * maxDelayMs);
    await enqueueScrapeJob(cred.driverId, 'cron', delay);
    enqueued++;
  }

  logger.info({ region, total: credentials.length, enqueued, skipped: alreadyQueued.size }, 'Cron scrape jobs enqueued');
  return enqueued;
}

/**
 * Run by the scheduler tick (called every hour).
 * Triggers Monday at 02:00 local time for each region.
 */
export async function schedulerTick(): Promise<void> {
  if (env.SCRAPE_ENABLED !== 'true') return;

  const regions: Region[] = ['HK', 'BR'];

  for (const region of regions) {
    const localDay = getLocalDayOfWeek(region);
    const localHour = getLocalHour(region);

    // Monday at 02:00 local time
    if (localDay === 1 && localHour === 2) {
      logger.info({ region, localDay, localHour }, 'Scheduler triggering weekly scrape');
      await enqueueRegionJobs(region);
    }
  }
}

/**
 * Expire credentials that are older than 14 days.
 * Called periodically (e.g., daily).
 */
export async function expireStaleCredentials(): Promise<number> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const result = await prisma.uberCredential.updateMany({
    where: {
      isValid: true,
      capturedAt: { lt: fourteenDaysAgo },
    },
    data: {
      isValid: false,
      invalidReason: 'Auto-expired after 14 days',
    },
  });

  if (result.count > 0) {
    logger.info({ expired: result.count }, 'Expired stale Uber credentials');
  }

  return result.count;
}

/**
 * Start the scheduler interval (runs every hour).
 */
export function startScheduler(): NodeJS.Timeout {
  logger.info('Scrape scheduler started (hourly tick)');

  // Run immediately on startup
  schedulerTick().catch((e) => logger.error({ err: e }, 'Scheduler tick error'));

  // Run credential expiry daily (check every 6 hours)
  setInterval(() => {
    expireStaleCredentials().catch((e) => logger.error({ err: e }, 'Credential expiry error'));
  }, 6 * 60 * 60 * 1000);

  // Hourly tick
  return setInterval(() => {
    schedulerTick().catch((e) => logger.error({ err: e }, 'Scheduler tick error'));
  }, 60 * 60 * 1000);
}
