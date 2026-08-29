import { describe, expect, it } from 'vitest';
import {
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from '../src/lib/password.js';

describe('password hashing', () => {
  it('produces a bcrypt hash that verifies', async () => {
    const hash = await hashPassword('SenhaMuitoForte#2026');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash).not.toContain('SenhaMuitoForte');
    await expect(verifyPassword('SenhaMuitoForte#2026', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('SenhaMuitoForte#2026');
    await expect(verifyPassword('SenhaMuitoForte#2027', hash)).resolves.toBe(false);
  });

  it('salts: the same password never yields the same hash twice', async () => {
    const [a, b] = await Promise.all([hashPassword('RepetidaMesma#1'), hashPassword('RepetidaMesma#1')]);
    expect(a).not.toBe(b);
  });

  /**
   * bcrypt truncates at 72 bytes. Without the HMAC pre-hash these two very long
   * passwords would share a prefix and verify interchangeably.
   */
  it('does not truncate long passwords at 72 bytes', async () => {
    const base = 'A'.repeat(72);
    const hash = await hashPassword(`${base}primeiro`);
    await expect(verifyPassword(`${base}segundo`, hash)).resolves.toBe(false);
    await expect(verifyPassword(`${base}primeiro`, hash)).resolves.toBe(true);
  });

  it('never throws on a malformed stored hash', async () => {
    await expect(verifyPassword('qualquer', 'nao-e-um-hash')).resolves.toBe(false);
  });
});

describe('password policy', () => {
  it('requires at least 10 characters', () => {
    expect(checkPasswordStrength('Curta#1a').ok).toBe(false);
  });

  it('requires three character classes', () => {
    expect(checkPasswordStrength('somenteletras').ok).toBe(false);
    expect(checkPasswordStrength('SomenteLetrasAqui').ok).toBe(false);
    expect(checkPasswordStrength('SenhaComNumero1').ok).toBe(true);
  });

  it('rejects well-known passwords', () => {
    expect(checkPasswordStrength('password1').ok).toBe(false);
  });

  it('rejects passwords containing the name or e-mail handle', () => {
    const result = checkPasswordStrength('Marina#2026Costa', ['Marina Costa', 'marina']);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/nome ou e-mail/i);
  });

  it('accepts a strong unrelated password', () => {
    expect(checkPasswordStrength('Canal#Privado2026', ['Marina Costa', 'marina']).ok).toBe(true);
  });
});
