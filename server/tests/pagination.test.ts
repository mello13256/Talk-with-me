import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../src/modules/messages/message.service.js';

const row = {
  created_at: new Date('2026-03-14T12:30:00.000Z'),
  id: '2a1f2f3e-8f6a-4d0e-9c9d-1b2c3d4e5f60',
};

describe('message cursors', () => {
  it('round-trips', () => {
    const decoded = decodeCursor(encodeCursor(row));
    expect(decoded).toEqual({ createdAt: '2026-03-14T12:30:00.000Z', id: row.id });
  });

  it('rejects anything malformed rather than passing it to SQL', () => {
    for (const value of [
      null,
      undefined,
      '',
      'not-base64!!',
      Buffer.from('sem-separador').toString('base64url'),
      Buffer.from('2026-03-14T12:30:00.000Z|not-a-uuid').toString('base64url'),
      Buffer.from("2026-03-14T12:30:00.000Z|' OR 1=1 --").toString('base64url'),
      Buffer.from(`data-invalida|${row.id}`).toString('base64url'),
    ]) {
      expect(decodeCursor(value as string | null), String(value)).toBeNull();
    }
  });
});
