import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './pool.js';
import { logger } from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Migrations are plain, ordered .sql files. Each runs exactly once, inside a
 * transaction that opens with a *transaction-scoped* advisory lock.
 *
 * The lock is deliberately `pg_advisory_xact_lock` rather than the session-level
 * `pg_advisory_lock`: a session lock held across separate statements is silently
 * lost behind a transaction-mode connection pooler (Supabase Supavisor on 6543,
 * PgBouncer, Neon pooled endpoints), because each statement may land on a
 * different backend. A transaction-scoped lock is held for the whole
 * BEGIN..COMMIT, which such poolers pin to one connection, and it is released
 * automatically on commit or rollback — including if the process is killed.
 *
 * Consequence for migration authors: a migration must be able to run inside a
 * transaction, so no CREATE INDEX CONCURRENTLY.
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
    // The bookkeeping table is created under the same lock: two instances
    // booting together would otherwise race on CREATE TABLE IF NOT EXISTS.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('COMMIT');

    let count = 0;
    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);

        // Re-checked *inside* the lock: another instance may have applied this
        // file while we were waiting for it.
        const already = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
        if (already.rowCount && already.rowCount > 0) {
          await client.query('COMMIT');
          continue;
        }

        logger.info('Applying migration', { file });
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        count += 1;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    logger.info(count ? `Applied ${count} migration(s)` : 'Database schema up to date');
  } finally {
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
