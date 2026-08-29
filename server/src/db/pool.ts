import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool, types } = pg;

// Return bigint columns (count(*), size_bytes) as JS numbers; every value we
// store in a bigint column is far below Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

pool.on('error', (error) => {
  logger.error('Unexpected idle client error', { error: error.message });
});

export type QueryParams = ReadonlyArray<unknown>;

/**
 * Every call site goes through these helpers with positional parameters.
 * String interpolation into SQL is never used anywhere in this codebase, which
 * is what rules out SQL injection structurally rather than by review.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<pg.QueryResult<T>> {
  const startedAt = performance.now();
  try {
    return await pool.query<T>(text, params as unknown[]);
  } finally {
    const ms = performance.now() - startedAt;
    if (ms > 250) {
      logger.warn('Slow query', { ms: Math.round(ms), sql: text.replace(/\s+/g, ' ').slice(0, 160) });
    }
  }
}

export async function rows<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

export async function maybeOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

export class NoRowsError extends Error {
  constructor() {
    super('Expected exactly one row, got none');
    this.name = 'NoRowsError';
  }
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParams = [],
): Promise<T> {
  const row = await maybeOne<T>(text, params);
  if (!row) throw new NoRowsError();
  return row;
}

export interface Tx {
  query: typeof query;
  rows: typeof rows;
  one: typeof one;
  maybeOne: typeof maybeOne;
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const scoped: Tx = {
    query: (text, params = []) => client.query(text, params as unknown[]) as never,
    rows: async (text, params = []) => (await client.query(text, params as unknown[])).rows as never,
    maybeOne: async (text, params = []) =>
      ((await client.query(text, params as unknown[])).rows[0] ?? null) as never,
    one: async (text, params = []) => {
      const result = await client.query(text, params as unknown[]);
      if (!result.rows[0]) throw new NoRowsError();
      return result.rows[0] as never;
    },
  };
  try {
    await client.query('BEGIN');
    const value = await fn(scoped);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/** Postgres unique-violation. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const err = error as { code?: string; constraint?: string };
  if (err?.code !== '23505') return false;
  return constraint ? err.constraint === constraint : true;
}
