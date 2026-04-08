import { prisma } from '../config/database.js';
import { AppError } from '../api/middleware/error-handler.js';
import { logger } from '../config/logger.js';
import type { Region } from '@prisma/client';

export async function getGiftCardCatalog(region: Region) {
  return prisma.giftCard.findMany({
    where: { region, isActive: true, stockCount: { gt: 0 } },
    select: {
      id: true,
      name: true,
      provider: true,
      pointsCost: true,
      faceValue: true,
      currency: true,
      imageUrl: true,
    },
    orderBy: { pointsCost: 'asc' },
  });
}

export async function redeemGiftCard(driverId: string, giftCardId: string) {
  // Pre-flight check (non-authoritative, just for fast error messages)
  const giftCard = await prisma.giftCard.findUnique({ where: { id: giftCardId } });
  if (!giftCard || !giftCard.isActive) {
    throw new AppError(404, 'Gift card not found or unavailable', 'GIFT_CARD_NOT_FOUND');
  }

  const driverPrecheck = await prisma.driver.findUniqueOrThrow({
    where: { id: driverId },
    select: { region: true },
  });

  if (driverPrecheck.region !== giftCard.region) {
    throw new AppError(403, 'Gift card not available in your region', 'REGION_MISMATCH');
  }

  // All real checks + mutations inside a serializable transaction to prevent races
  const redemption = await prisma.$transaction(async (tx) => {
    // Conditional update: only deduct if balance is sufficient (atomic check-and-set)
    const driverUpdate = await tx.driver.updateMany({
      where: { id: driverId, pointsBalance: { gte: giftCard.pointsCost } },
      data: { pointsBalance: { decrement: giftCard.pointsCost } },
    });
    if (driverUpdate.count === 0) {
      throw new AppError(400, 'Insufficient points', 'INSUFFICIENT_POINTS');
    }

    // Conditional update: only deduct if stock > 0 (atomic)
    const stockUpdate = await tx.giftCard.updateMany({
      where: { id: giftCardId, stockCount: { gt: 0 } },
      data: { stockCount: { decrement: 1 } },
    });
    if (stockUpdate.count === 0) {
      throw new AppError(409, 'Gift card out of stock', 'OUT_OF_STOCK');
    }

    // Read the updated balance for the ledger entry
    const updatedDriver = await tx.driver.findUniqueOrThrow({
      where: { id: driverId },
      select: { pointsBalance: true },
    });

    await tx.pointLedger.create({
      data: {
        driverId,
        amount: -giftCard.pointsCost,
        balance: updatedDriver.pointsBalance,
        type: 'redemption',
        description: `Redeemed: ${giftCard.name}`,
      },
    });

    const r = await tx.redemption.create({
      data: {
        driverId,
        giftCardId,
        pointsSpent: giftCard.pointsCost,
        status: 'PENDING',
      },
    });

    await tx.auditLog.create({
      data: {
        driverId,
        action: 'REDEEM_GIFT_CARD',
        resource: 'redemption',
        resourceId: r.id,
        details: {
          giftCardId,
          giftCardName: giftCard.name,
          pointsSpent: giftCard.pointsCost,
        },
      },
    });

    return r;
  });

  logger.info(
    { driverId, redemptionId: redemption.id, giftCardId, points: giftCard.pointsCost },
    'Gift card redeemed',
  );

  // TODO: Queue async job to fulfill via gift card provider API
  // await giftCardFulfillmentQueue.add('fulfill', { redemptionId: redemption.id });

  return {
    redemptionId: redemption.id,
    status: redemption.status,
    giftCardName: giftCard.name,
    pointsSpent: giftCard.pointsCost,
  };
}

export async function getDriverRedemptions(driverId: string, page: number = 1, limit: number = 20) {
  const offset = (page - 1) * limit;

  const [redemptions, total] = await Promise.all([
    prisma.redemption.findMany({
      where: { driverId },
      include: {
        giftCard: { select: { name: true, provider: true, faceValue: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.redemption.count({ where: { driverId } }),
  ]);

  const mapped = redemptions.map((r) => ({
    id: r.id,
    giftCardName: r.giftCard.name,
    giftCardProvider: r.giftCard.provider,
    faceValue: r.giftCard.faceValue,
    currency: r.giftCard.currency,
    pointsSpent: r.pointsSpent,
    status: r.status,
    giftCardCode: r.status === 'FULFILLED' ? r.giftCardCode : null,
    failureReason: r.failureReason,
    createdAt: r.createdAt,
    fulfilledAt: r.fulfilledAt,
    giftCard: r.giftCard,
  }));

  return { redemptions: mapped, total, page, limit };
}
