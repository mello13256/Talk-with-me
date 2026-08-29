import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[env.LOG_LEVEL];

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(context ?? {}),
  };
  const line = env.NODE_ENV === 'development' ? prettify(entry) : JSON.stringify(entry);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function prettify(entry: Record<string, unknown>): string {
  const { ts, level, msg, ...rest } = entry as {
    ts: string;
    level: Level;
    msg: string;
    [k: string]: unknown;
  };
  const tone = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' }[level];
  const extras = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  return `${tone}${level.toUpperCase().padEnd(5)}\x1b[0m ${ts.slice(11, 23)} ${msg}${extras}`;
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};
