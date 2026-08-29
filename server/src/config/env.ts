import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

// First definition wins (dotenv never overrides an existing value), so real
// environment variables always beat a file, and server/.env beats the repo root.
for (const candidate of [
  path.resolve(here, '../../.env'), // server/.env  (src/config and dist/config alike)
  path.resolve(here, '../../../.env'), // repository root
  '.env', // current working directory
]) {
  dotenv.config({ path: candidate });
}

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .default(fallback ? 'true' : 'false');

const csv = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .default('');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_URL: z.string().url().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_SSL: bool(false),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

    /** Server-side key used to HMAC session/reset tokens before storage. */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_COOKIE_NAME: z.string().default('twm_session'),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
    /** Secret mixed into every password hash. Changing it invalidates all passwords. */
    PASSWORD_PEPPER: z.string().min(16, 'PASSWORD_PEPPER must be at least 16 characters'),
    BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

    CORS_ORIGINS: csv,
    ALLOW_PUBLIC_REGISTRATION: bool(true),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    MAX_UPLOAD_MB: z.coerce.number().positive().max(200).default(25),

    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(true),

    MAIL_DRIVER: z.enum(['console', 'smtp', 'resend']).default('console'),
    MAIL_FROM: z.string().default('Talk with me <no-reply@localhost>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),

    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    /**
     * First-boot administrator. Only ever used when the database has no
     * administrator yet, so these cannot be set later to take over an account.
     */
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().min(10).max(200).optional(),
    ADMIN_NAME: z.string().min(2).max(120).default('Administrador'),

    /**
     * Escape hatch for a first deploy: lets MAIL_DRIVER=console run in
     * production, where password-reset links are only printed to the log.
     * Explicit and loudly warned about, so it cannot happen by accident.
     */
    ALLOW_INSECURE_MAIL: bool(false),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }
    if (cfg.MAIL_DRIVER === 'smtp' && !cfg.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when MAIL_DRIVER=smtp',
      });
    }
    if (cfg.MAIL_DRIVER === 'resend' && !cfg.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when MAIL_DRIVER=resend',
      });
    }
    if (cfg.NODE_ENV === 'production' && cfg.MAIL_DRIVER === 'console' && !cfg.ALLOW_INSECURE_MAIL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_DRIVER'],
        message:
          'MAIL_DRIVER=console only prints reset links to the log. Configure smtp or resend, ' +
          'or set ALLOW_INSECURE_MAIL=true to accept that during a first deploy.',
      });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${details}\n\nSee .env.example.\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export const MAX_UPLOAD_BYTES = Math.round(env.MAX_UPLOAD_MB * 1024 * 1024);
export const SESSION_TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
