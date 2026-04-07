import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { signAccessToken } from '../src/utils/jwt.js';
import { signAdminToken } from '../src/utils/admin-jwt.js';

export const testPrisma = new PrismaClient();

export async function cleanDatabase() {
  await testPrisma.$transaction([
    testPrisma.auditLog.deleteMany(),
    testPrisma.consent.deleteMany(),
    testPrisma.pointLedger.deleteMany(),
    testPrisma.redemption.deleteMany(),
    testPrisma.activitySync.deleteMany(),
    testPrisma.uberSession.deleteMany(),
    testPrisma.refreshToken.deleteMany(),
    testPrisma.trip.deleteMany(),
    testPrisma.giftCard.deleteMany(),
    testPrisma.driver.deleteMany(),
    testPrisma.admin.deleteMany(),
  ]);
}

export async function createTestDriver(overrides: Partial<{
  email: string;
  region: 'HK' | 'BR';
  pointsBalance: number;
  status: string;
}> = {}) {
  const password = 'TestPass123!';
  const passwordHash = await bcrypt.hash(password, 4); // fast for tests

  const driver = await testPrisma.driver.create({
    data: {
      email: overrides.email || `driver-${uuid().slice(0, 8)}@test.com`,
      passwordHash,
      nameEncrypted: Buffer.from('Test Driver'),
      region: overrides.region || 'HK',
      status: (overrides.status as any) || 'ACTIVE',
      referralCode: uuid().slice(0, 10).toUpperCase(),
      pointsBalance: overrides.pointsBalance ?? 0,
    },
  });

  const accessToken = await signAccessToken(driver.id, driver.region);

  return { driver, password, accessToken };
}

export async function createTestAdmin(overrides: Partial<{
  email: string;
  role: string;
}> = {}) {
  const password = 'AdminTestPass123!@#';
  const passwordHash = await bcrypt.hash(password, 4);

  const admin = await testPrisma.admin.create({
    data: {
      email: overrides.email || `admin-${uuid().slice(0, 8)}@test.com`,
      passwordHash,
      name: 'Test Admin',
      role: (overrides.role as any) || 'SUPER_ADMIN',
    },
  });

  const token = await signAdminToken(admin.id, admin.email, admin.role);

  return { admin, password, token };
}

export async function createTestGiftCard(region: 'HK' | 'BR' = 'HK', overrides: Partial<{
  pointsCost: number;
  stockCount: number;
}> = {}) {
  return testPrisma.giftCard.create({
    data: {
      name: `Test Gift Card ${uuid().slice(0, 6)}`,
      provider: 'TestProvider',
      region,
      pointsCost: overrides.pointsCost ?? 100,
      faceValue: 50,
      currency: region === 'HK' ? 'HKD' : 'BRL',
      stockCount: overrides.stockCount ?? 10,
    },
  });
}

export function makeTripPayload(overrides: Partial<{
  tripUuid: string;
  fareAmount: number;
  netEarnings: number;
  requestedAt: number;
  currency: string;
  vehicleType: string;
  isSurge: boolean;
}> = {}) {
  const tripUuid = overrides.tripUuid || uuid();
  return {
    tripUuid,
    vehicleType: overrides.vehicleType ?? 'UberX',
    requestedAt: overrides.requestedAt ?? Math.floor(Date.now() / 1000) - 3600,
    durationSeconds: 300,
    distanceMeters: 5000,
    pickupDistrict: 'Central',
    dropoffDistrict: 'Wan Chai',
    currency: overrides.currency ?? 'HKD',
    fareAmount: overrides.fareAmount ?? 45.00,
    serviceFee: 10.00,
    bookingFee: 6.00,
    tolls: 0,
    tips: 5.00,
    netEarnings: overrides.netEarnings ?? 34.00,
    isPoolType: false,
    isSurge: overrides.isSurge ?? false,
    uberPoints: 3,
    rawPayloadHash: 'a'.repeat(64),
  };
}
