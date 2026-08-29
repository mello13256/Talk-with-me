import { env, isProduction } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { checkPasswordStrength, hashPassword } from '../../lib/password.js';
import { maybeOne, query } from '../../db/pool.js';

/**
 * Creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * This exists so a platform without shell access (a free plan, a one-click
 * deploy) can still be set up. It is deliberately narrow:
 *
 *  - it runs only when the database contains no administrator at all, so
 *    setting these variables later can never take over or create a second
 *    privileged account;
 *  - it refuses a weak password, exactly like every other entry point;
 *  - it never logs the password.
 *
 * Once the account exists, remove ADMIN_PASSWORD from the environment.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;

  const existing = await maybeOne<{ id: string }>(
    `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
  );
  if (existing) {
    logger.info('Bootstrap admin skipped: an administrator already exists');
    return;
  }

  const strength = checkPasswordStrength(env.ADMIN_PASSWORD, [
    env.ADMIN_NAME,
    env.ADMIN_EMAIL.split('@')[0] ?? '',
  ]);
  if (!strength.ok) {
    logger.error('Bootstrap admin rejected: weak ADMIN_PASSWORD', { reason: strength.reason });
    return;
  }

  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);

  // A pre-existing client with this e-mail is promoted rather than duplicated,
  // since users.email is unique.
  const promoted = await query(
    `UPDATE users
        SET role = 'admin', name = $2, password_hash = $3,
            password_changed_at = now(), is_blocked = false
      WHERE email = $1
      RETURNING id`,
    [env.ADMIN_EMAIL, env.ADMIN_NAME, passwordHash],
  );

  if (promoted.rowCount === 0) {
    await query(`INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`, [
      env.ADMIN_NAME,
      env.ADMIN_EMAIL,
      passwordHash,
    ]);
  }

  logger.warn('Bootstrap administrator created from environment variables', {
    email: env.ADMIN_EMAIL,
    action: 'Remove ADMIN_PASSWORD from the environment now, then change the password in the app.',
  });
}

/** Warns loudly when a deployment is running with a reduced-safety setting. */
export function warnAboutInsecureDefaults(): void {
  if (!isProduction) return;

  if (env.MAIL_DRIVER === 'console' && env.ALLOW_INSECURE_MAIL) {
    logger.warn(
      'MAIL_DRIVER=console in production: password reset links are only printed to this log. ' +
        'Configure SMTP or Resend before real clients rely on account recovery.',
    );
  }
  if (env.STORAGE_DRIVER === 'local') {
    logger.warn(
      'STORAGE_DRIVER=local: attachments live on this instance disk. Without a persistent volume ' +
        'they are lost on every redeploy. Use STORAGE_DRIVER=s3 for durable storage.',
    );
  }
  if (env.ADMIN_PASSWORD) {
    logger.warn('ADMIN_PASSWORD is still set in the environment. Remove it now that setup is done.');
  }
}
