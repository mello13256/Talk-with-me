import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  size: number;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  createReadStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Object keys are generated server-side and always match this shape. Validated
 * again before touching the filesystem so a tampered database row cannot turn
 * into a path traversal.
 */
export const STORAGE_KEY_PATTERN = /^[a-z]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/;

export function assertSafeKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key) || key.includes('..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
