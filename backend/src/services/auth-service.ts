import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../config/database.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { encrypt } from '../utils/encryption.js';
import { AppError } from '../api/middleware/error-handler.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import type { RegisterInput } from '../api/validators/auth.js';

const SALT_ROUNDS = 12;

function parseExpiresIn(val: string): number {
  const match = val.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(match[1]);
  const unit = match[2];
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] || 1000;
  return n * ms;
}

const REFRESH_TOKEN_TTL_MS = parseExpiresIn(env.JWT_REFRESH_EXPIRES_IN);

function generateReferralCode(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function registerDriver(input: RegisterInput, ip?: string, userAgent?: string) {
  const existing = await prisma.driver.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'Email already registered', 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const nameEncrypted = Buffer.from(encrypt(input.name));

  let referrerId: string | undefined;
  if (input.referralCode) {
    const referrer = await prisma.driver.findUnique({
      where: { referralCode: input.referralCode },
      select: { id: true },
    });
    if (referrer) {
      referrerId = referrer.id;
    }
  }

  const driver = await prisma.$transaction(async (tx) => {
    const d = await tx.driver.create({
      data: {
        email: input.email,
        passwordHash,
        nameEncrypted,
        phone: input.phone,
        region: input.region,
        referralCode: generateReferralCode(),
        referredBy: referrerId,
      },
    });

    await tx.consent.create({
      data: {
        driverId: d.id,
        type: 'DATA_COLLECTION',
        granted: true,
        ipAddress: ip,
        userAgent,
      },
    });

    await tx.auditLog.create({
      data: {
        driverId: d.id,
        action: 'REGISTER',
        resource: 'driver',
        resourceId: d.id,
        ipAddress: ip,
      },
    });

    return d;
  });

  const accessToken = await signAccessToken(driver.id, driver.region);
  const refreshToken = await signRefreshToken(driver.id, driver.region);

  await prisma.refreshToken.create({
    data: {
      driverId: driver.id,
      tokenHash: hashToken(refreshToken),
      userAgent,
      ipAddress: ip,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  logger.info({ driverId: driver.id, region: driver.region }, 'Driver registered');

  return {
    driver: {
      id: driver.id,
      email: driver.email,
      region: driver.region,
      referralCode: driver.referralCode,
      pointsBalance: driver.pointsBalance,
    },
    accessToken,
    refreshToken,
  };
}

export async function loginDriver(email: string, password: string, ip?: string, userAgent?: string) {
  const driver = await prisma.driver.findUnique({ where: { email } });
  if (!driver || driver.deletedAt) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  if (driver.status === 'SUSPENDED') {
    throw new AppError(403, 'Account suspended', 'ACCOUNT_SUSPENDED');
  }

  const valid = await bcrypt.compare(password, driver.passwordHash);
  if (!valid) {
    logger.warn({ email, ip }, 'Failed login attempt');
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const accessToken = await signAccessToken(driver.id, driver.region);
  const refreshToken = await signRefreshToken(driver.id, driver.region);

  await prisma.refreshToken.create({
    data: {
      driverId: driver.id,
      tokenHash: hashToken(refreshToken),
      userAgent,
      ipAddress: ip,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  await prisma.driver.update({
    where: { id: driver.id },
    data: { lastActiveAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      driverId: driver.id,
      action: 'LOGIN',
      resource: 'driver',
      resourceId: driver.id,
      ipAddress: ip,
    },
  });

  return {
    driver: {
      id: driver.id,
      email: driver.email,
      region: driver.region,
      referralCode: driver.referralCode,
      pointsBalance: driver.pointsBalance,
      lifetimePoints: driver.lifetimePoints,
    },
    accessToken,
    refreshToken,
  };
}

export async function refreshAccessToken(refreshTokenValue: string, ip?: string) {
  const payload = await verifyRefreshToken(refreshTokenValue).catch(() => {
    throw new AppError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  });

  const tokenHash = hashToken(refreshTokenValue);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError(401, 'Refresh token expired or revoked', 'TOKEN_REVOKED');
  }

  // Rotate: revoke old, issue new
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const newAccessToken = await signAccessToken(payload.sub, payload.region);
  const newRefreshToken = await signRefreshToken(payload.sub, payload.region);

  await prisma.refreshToken.create({
    data: {
      driverId: payload.sub,
      tokenHash: hashToken(newRefreshToken),
      ipAddress: ip,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function requestPasswordReset(email: string, ip?: string) {
  const driver = await prisma.driver.findUnique({ where: { email } });

  // Always return success to prevent email enumeration
  if (!driver || driver.deletedAt || driver.status === 'SUSPENDED') {
    logger.info({ email, ip }, 'Password reset requested for unknown/invalid email');
    return { message: 'If that email is registered, a reset code has been sent.' };
  }

  // Generate a 6-digit numeric code (user-friendly for manual entry in extension)
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = hashToken(code);

  await prisma.driver.update({
    where: { id: driver.id },
    data: {
      resetTokenHash: codeHash,
      resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  await prisma.auditLog.create({
    data: {
      driverId: driver.id,
      action: 'PASSWORD_RESET_REQUEST',
      resource: 'driver',
      resourceId: driver.id,
      ipAddress: ip,
    },
  });

  // TODO: Replace with actual email delivery (SendGrid/SES/Resend).
  // Until email is configured, we return the code directly so the client can display it.
  logger.info({ email, ip }, 'Password reset code generated');
  return {
    message: 'If that email is registered, a reset code has been generated.',
    _resetCode: code,
  };
}

export async function resetPassword(email: string, code: string, newPassword: string, ip?: string) {
  const driver = await prisma.driver.findUnique({ where: { email } });

  if (!driver || !driver.resetTokenHash || !driver.resetTokenExpiresAt) {
    throw new AppError(400, 'Invalid or expired reset code', 'INVALID_RESET_CODE');
  }

  if (driver.resetTokenExpiresAt < new Date()) {
    // Clear expired token
    await prisma.driver.update({
      where: { id: driver.id },
      data: { resetTokenHash: null, resetTokenExpiresAt: null },
    });
    throw new AppError(400, 'Reset code has expired. Please request a new one.', 'RESET_CODE_EXPIRED');
  }

  const codeHash = hashToken(code);
  if (codeHash !== driver.resetTokenHash) {
    throw new AppError(400, 'Invalid reset code', 'INVALID_RESET_CODE');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.driver.update({
      where: { id: driver.id },
      data: {
        passwordHash,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });

    // Revoke all existing refresh tokens for security
    await tx.refreshToken.updateMany({
      where: { driverId: driver.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        driverId: driver.id,
        action: 'PASSWORD_RESET_COMPLETE',
        resource: 'driver',
        resourceId: driver.id,
        ipAddress: ip,
      },
    });
  });

  logger.info({ driverId: driver.id, ip }, 'Password reset completed');
  return { message: 'Password has been reset. Please sign in with your new password.' };
}
