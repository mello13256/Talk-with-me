import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, timingSafeEqual } from '../src/lib/crypto.js';

describe('token handling', () => {
  it('generates URL-safe tokens with enough entropy', () => {
    const token = generateToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
  });

  it('hashes deterministically, and the digest is not the token', () => {
    const token = generateToken();
    expect(hashToken(token).equals(hashToken(token))).toBe(true);
    expect(hashToken(token).toString('utf8')).not.toContain(token);
    expect(hashToken(token).equals(hashToken(generateToken()))).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  it('rejects different strings, including different lengths', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abc123')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });
});
