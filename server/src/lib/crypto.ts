import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** URL-safe random token, 32 bytes of entropy. */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Keyed digest used for session and password-reset tokens. Keyed (rather than
 * plain SHA-256) so that a database dump alone cannot be used to derive or
 * verify a valid token without also holding SESSION_SECRET.
 */
export function hashToken(token: string): Buffer {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(token).digest();
}

export function sha256Hex(input: Buffer | string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison that tolerates differing lengths. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still perform a comparison to keep the timing profile flat.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function randomId(): string {
  return crypto.randomUUID();
}
