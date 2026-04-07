import { Queue, Worker } from 'bullmq';
import { Prisma } from '@prisma/client';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

const QUEUE_NAME = 'data-purge';

export const dataPurgeQueue = new Queue(QUEUE_NAME, { connection: redis });

export function startDataPurgeWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case 'purge-raw-payloads':
          await purgeRawPayloads();
          break;
        case 'purge-expired-tokens':
          await purgeExpiredTokens();
          break;
        case 'expire-points':
          await expirePoints();
          break;
        case 'purge-ip-addresses':
          await purgeIpAddresses();
          break;
        default:
          logger.warn({ jobName: job.name }, 'Unknown purge job');
      }
    },
    { connection: redis },
  );

  worker.on('completed', (job) => {
    logger.info({ jobName: job.name }, 'Purge job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobName: job?.name, err }, 'Purge job failed');
  });

  return worker;
}

async function purgeRawPayloads() {
  const result = await prisma.trip.updateMany({
    where: {
      rawPayloadPurgeAt: { lte: new Date() },
      rawPayload: { not: Prisma.DbNull },
    },
    data: { rawPayload: Prisma.DbNull },
  });

  logger.info({ count: result.count }, 'Purged raw payloads');
}

async function purgeExpiredTokens() {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: new Date() } },
        { revokedAt: { not: null } },
      ],
    },
  });

  logger.info({ count: result.count }, 'Purged expired/revoked refresh tokens');
}

async function expirePoints() {
  const expiredEntries = await prisma.pointLedger.findMany({
    where: {
      expiresAt: { lte: new Date() },
      amount: { gt: 0 },
      type: 'trip_earn',
    },
    select: { id: true, driverId: true, amount: true },
  });

  for (const entry of expiredEntries) {
    await prisma.$transaction(async (tx) => {
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: entry.driverId },
        select: { pointsBalance: true },
      });

      const deduction = Math.min(entry.amount, driver.pointsBalance);
      if (deduction <= 0) return;

      const newBalance = driver.pointsBalance - deduction;

      await tx.pointLedger.create({
        data: {
          driverId: entry.driverId,
          amount: -deduction,
          balance: newBalance,
          type: 'expiry',
          description: `Points expired (earned > 365 days ago)`,
        },
      });

      await tx.driver.update({
        where: { id: entry.driverId },
        data: { pointsBalance: { decrement: deduction } },
      });
    });
  }

  logger.info({ count: expiredEntries.length }, 'Processed point expirations');
}

async function purgeIpAddresses() {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const auditResult = await prisma.auditLog.updateMany({
    where: {
      createdAt: { lte: ninetyDaysAgo },
      ipAddress: { not: null },
    },
    data: { ipAddress: null },
  });

  const consentResult = await prisma.consent.updateMany({
    where: {
      grantedAt: { lte: ninetyDaysAgo },
      ipAddress: { not: null },
    },
    data: { ipAddress: null },
  });

  logger.info(
    { auditLogs: auditResult.count, consents: consentResult.count },
    'Purged old IP addresses',
  );
}

export async function scheduleRecurringPurgeJobs() {
  await dataPurgeQueue.add('purge-raw-payloads', {}, {
    repeat: { pattern: '0 3 * * *' },
  });

  await dataPurgeQueue.add('purge-expired-tokens', {}, {
    repeat: { pattern: '0 4 * * *' },
  });

  await dataPurgeQueue.add('expire-points', {}, {
    repeat: { pattern: '0 5 1 * *' },
  });

  await dataPurgeQueue.add('purge-ip-addresses', {}, {
    repeat: { pattern: '0 3 1 * *' },
  });

  logger.info('Recurring data purge jobs scheduled');
}
