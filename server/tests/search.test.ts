import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from '../src/lib/validation.js';

/**
 * The search term reaches SQL as a bound parameter, so this is not about SQL
 * injection. It is about a user controlling the *pattern*: an unescaped "%"
 * matches every row, which is both a wrong result and a full table scan the
 * caller can trigger at will.
 */
describe('escapeLikePattern', () => {
  it('escapes the LIKE wildcards', () => {
    expect(escapeLikePattern('%')).toBe('\\%');
    expect(escapeLikePattern('_')).toBe('\\_');
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes the escape character itself, so it cannot be smuggled in', () => {
    expect(escapeLikePattern('\\')).toBe('\\\\');
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('leaves ordinary search terms untouched', () => {
    for (const term of ['pedido 4417', 'nota fiscal', 'contato@exemplo.com', 'ação']) {
      expect(escapeLikePattern(term)).toBe(term);
    }
  });

  it('is idempotent in shape: escaping twice never loses a character', () => {
    const once = escapeLikePattern('50%_off');
    expect(escapeLikePattern(once).length).toBeGreaterThanOrEqual(once.length);
  });
});
