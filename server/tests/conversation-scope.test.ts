import { describe, expect, it } from 'vitest';
import { unreadPredicate } from '../src/modules/conversations/conversation.service.js';

/**
 * The unread predicate is what decides which rows a "mark as read" touches.
 * It must always be expressed against the conversation's own client_id, never
 * against a value supplied by the caller.
 */
describe('unreadPredicate', () => {
  it("puts everything not written by the client in the client's inbox", () => {
    expect(unreadPredicate('client')).toBe('m.sender_id IS DISTINCT FROM c.client_id');
  });

  it("puts only what the client wrote in the operator's inbox", () => {
    expect(unreadPredicate('admin')).toBe('m.sender_id = c.client_id');
  });

  it('supports an explicit table alias without string surgery at the call site', () => {
    expect(unreadPredicate('admin', 'target')).toBe('target.sender_id = c.client_id');
  });

  it('never interpolates a caller-supplied identifier', () => {
    // Both branches reference only c.client_id, so no user value reaches the SQL.
    for (const role of ['client', 'admin'] as const) {
      expect(unreadPredicate(role)).toContain('c.client_id');
      expect(unreadPredicate(role)).not.toMatch(/\$|'/);
    }
  });
});
