import { env } from '../config/env.js';
import { localStorage } from './local.js';
import { s3Storage } from './s3.js';
import type { StorageDriver } from './types.js';

export const storage: StorageDriver = env.STORAGE_DRIVER === 's3' ? s3Storage : localStorage;
export type { StorageDriver } from './types.js';
