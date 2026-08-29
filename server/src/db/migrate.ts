import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './pool.js';
import { logger } from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Migrations are plain, ordered .sql files. Each runs once inside its own
 * transaction, guarded by a session-level advisory lock so that concurrent boots
 * (rolling deploys) cannot apply the same file twice.
 */
const ADVISORY_LOCK_KEY = 8_421_337;

async function migrationsDir(): Promise<string> {
  const candidates = [path.join(here, 'migrations'), path.join(here, '../../src/db/migrations')];
  for (const dir of candidates) {
    try {
      await fs.access(dir);
      return dir;
    } catch {
      /* try next */
    }
  }
  throw new Error('Migrations directory not found');
}

export async function runMigrations(): Promise<void> {
  const dir = await migrationsDir();
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      logger.info('Applying migration', { file });
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        count += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    logger.info(count ? `Applied ${count} migration(s)` : 'Database schema up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));

if (invokedDirectly) {
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((error: Error) => {
      logger.error('Migration failed', { error: error.message });
      process.exit(1);
    });
}
