import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!_cachedKey) {
    _cachedKey = Buffer.from(env.ENCRYPTION_KEY, 'hex');
    if (_cachedKey.length !== 32) {
      throw new Error(`ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${_cachedKey.length} bytes.`);
    }
  }
  return _cachedKey;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decrypt(ciphertext: string): string {
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Invalid ciphertext format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function hashPayload(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}
