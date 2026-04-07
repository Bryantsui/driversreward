import * as jose from 'jose';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface TokenPayload {
  sub: string;  // driver UUID
  region: string;
  type: 'access' | 'refresh';
}

function parseExpiry(expiry: string): string {
  return expiry;
}

export async function signAccessToken(driverId: string, region: string): Promise<string> {
  return new jose.SignJWT({ region, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(driverId)
    .setIssuedAt()
    .setExpirationTime(parseExpiry(env.JWT_ACCESS_EXPIRES_IN))
    .sign(accessSecret);
}

export async function signRefreshToken(driverId: string, region: string): Promise<string> {
  return new jose.SignJWT({ region, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(driverId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(parseExpiry(env.JWT_REFRESH_EXPIRES_IN))
    .sign(refreshSecret);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const { payload } = await jose.jwtVerify(token, accessSecret);
  return {
    sub: payload.sub as string,
    region: payload.region as string,
    type: 'access',
  };
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload> {
  const { payload } = await jose.jwtVerify(token, refreshSecret);
  return {
    sub: payload.sub as string,
    region: payload.region as string,
    type: 'refresh',
  };
}
