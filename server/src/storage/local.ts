import fs from 'node:fs/promises';
import { createReadStream as fsCreateReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { assertSafeKey, type StorageDriver, type StoredObject } from './types.js';

const root = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);

function resolveKey(key: string): string {
  assertSafeKey(key);
  const full = path.resolve(root, key);
  // Defence in depth: the resolved path must stay inside the storage root.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Storage key escapes storage root');
  }
  return full;
}

export const localStorage: StorageDriver = {
  name: 'local',

  async put(key, body): Promise<StoredObject> {
    const full = resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, { mode: 0o600 });
    return { key, size: body.byteLength };
  },

  async createReadStream(key): Promise<Readable> {
    const full = resolveKey(key);
    await fs.access(full);
    return fsCreateReadStream(full);
  },

  async delete(key): Promise<void> {
    try {
      await fs.unlink(resolveKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  },

  async exists(key): Promise<boolean> {
    try {
      await fs.access(resolveKey(key));
      return true;
    } catch {
      return false;
    }
  },
};
