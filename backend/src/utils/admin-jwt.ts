import * as jose from 'jose';
import { env } from '../config/env.js';

const adminSecret = new TextEncoder().encode(env.JWT_ADMIN_SECRET || env.JWT_ACCESS_SECRET + '_admin');

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  type: 'admin';
}

export async function signAdminToken(adminId: string, email: string, role: string): Promise<string> {
  return new jose.SignJWT({ email, role, type: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime('4h')
    .sign(adminSecret);
}

export async function verifyAdminToken(token: string): Promise<AdminTokenPayload> {
  const { payload } = await jose.jwtVerify(token, adminSecret);
  if (payload.type !== 'admin') {
    throw new Error('Not an admin token');
  }
  return {
    sub: payload.sub as string,
    email: payload.email as string,
    role: payload.role as string,
    type: 'admin',
  };
}
