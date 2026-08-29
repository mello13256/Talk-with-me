import { describe, expect, it } from 'vitest';
import { ALLOWED_MIME, isInlineSafe, sanitizeFilename } from '../src/modules/attachments/attachment.service.js';
import { assertSafeKey } from '../src/storage/types.js';

describe('upload allow-list', () => {
  it('accepts the expected document and image types', () => {
    for (const mime of ['image/png', 'image/jpeg', 'application/pdf', 'text/plain']) {
      expect(ALLOWED_MIME[mime]).toBeTruthy();
    }
  });

  it('never accepts types that execute in a browser', () => {
    for (const mime of [
      'image/svg+xml',
      'text/html',
      'application/xhtml+xml',
      'application/javascript',
      'text/javascript',
      'application/x-httpd-php',
      'application/octet-stream',
    ]) {
      expect(ALLOWED_MIME[mime]).toBeUndefined();
    }
  });

  it('only renders inline what is safe to render inline', () => {
    expect(isInlineSafe('image/png')).toBe(true);
    expect(isInlineSafe('application/pdf')).toBe(true);
    // Everything else must arrive as a download, never rendered in the origin.
    expect(isInlineSafe('text/plain')).toBe(false);
    expect(isInlineSafe('application/zip')).toBe(false);
    expect(isInlineSafe('image/svg+xml')).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  it('strips directory components', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Windows\\system32\\config')).toBe('config');
  });

  it('strips quotes and control characters that would break Content-Disposition', () => {
    // Quoting characters would let a filename escape the header value.
    const quoted = sanitizeFilename('nota"maliciosa.pdf');
    expect(quoted).not.toContain('"');
    expect(quoted).toBe('notamaliciosa.pdf');

    expect(sanitizeFilename('back\\slash.pdf')).not.toContain('\\');
    expect(sanitizeFilename('linha\nquebrada.txt')).not.toContain('\n');
    expect(sanitizeFilename('tab\tseparado.txt')).not.toContain('\t');
  });

  it('always returns something usable', () => {
    expect(sanitizeFilename('')).toBe('arquivo');
    expect(sanitizeFilename('///')).toBe('arquivo');
  });

  it('caps the length', () => {
    expect(sanitizeFilename(`${'a'.repeat(500)}.pdf`).length).toBeLessThanOrEqual(200);
  });
});

describe('storage keys', () => {
  it('accepts the keys the service generates', () => {
    expect(() =>
      assertSafeKey('messages/2a1f2f3e-8f6a-4d0e-9c9d-1b2c3d4e5f60/8f6a2a1f-4d0e-4d0e-9c9d-1b2c3d4e5f61.png'),
    ).not.toThrow();
  });

  it('rejects traversal and absolute paths', () => {
    for (const key of [
      '../../etc/passwd',
      'messages/../../../etc/passwd',
      '/etc/passwd',
      'messages/2a1f2f3e-8f6a-4d0e-9c9d-1b2c3d4e5f60/../../secret.png',
      'messages/x/y.png',
    ]) {
      expect(() => assertSafeKey(key), key).toThrow();
    }
  });
});
