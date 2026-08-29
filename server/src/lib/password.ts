import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

/**
 * bcrypt silently truncates input at 72 bytes and rejects NUL bytes, so the
 * password is first folded into a fixed-length base64 HMAC. The HMAC key acts
 * as a server-side pepper: a leaked password_hash column is not offline
 * crackable without PASSWORD_PEPPER, which lives outside the database.
 */
function prehash(plain: string): string {
  return crypto.createHmac('sha256', env.PASSWORD_PEPPER).update(plain, 'utf8').digest('base64');
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(prehash(plain), env.BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(prehash(plain), hash);
  } catch {
    return false;
  }
}

/** Dummy verification used to equalize timing on unknown-email logins. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.ZaVDXwYr1CO2A9jVQVYVBQaCTvBSCVy';

export async function fakeVerify(): Promise<void> {
  await bcrypt.compare(prehash('not-a-real-password'), DUMMY_HASH);
}

const COMMON = new Set([
  '12345678', '123456789', 'password', 'senha123', 'qwerty123',
  '11111111', 'abc12345', 'password1', 'iloveyou', '12345678910',
]);

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

export function checkPasswordStrength(plain: string, context: string[] = []): PasswordCheck {
  if (plain.length < 10) return { ok: false, reason: 'A senha precisa ter ao menos 10 caracteres.' };
  if (plain.length > 200) return { ok: false, reason: 'A senha é longa demais.' };
  if (COMMON.has(plain.toLowerCase())) return { ok: false, reason: 'Essa senha é muito comum.' };
  const lower = plain.toLowerCase();
  for (const hint of context) {
    const value = hint?.trim().toLowerCase();
    if (value && value.length >= 4 && lower.includes(value)) {
      return { ok: false, reason: 'A senha não pode conter seu nome ou e-mail.' };
    }
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(plain)).length;
  if (classes < 3) {
    return {
      ok: false,
      reason: 'Use ao menos três tipos de caractere (maiúsculas, minúsculas, números, símbolos).',
    };
  }
  return { ok: true };
}
