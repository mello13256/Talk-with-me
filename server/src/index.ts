import http from 'node:http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { checkDatabase, closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './app.js';
import { initRealtime } from './realtime/socket.js';
import { resetPresenceOnBoot } from './realtime/hub.js';
import { purgeExpiredSessions } from './modules/auth/session.service.js';
import { ensureBootstrapAdmin, warnAboutInsecureDefaults } from './modules/auth/bootstrap.js';
import { purgeOrphanAttachments } from './modules/attachments/attachment.service.js';

const HOUR = 60 * 60 * 1000;

async function main(): Promise<void> {
  await checkDatabase();
  await runMigrations();
  await ensureBootstrapAdmin();
  await resetPresenceOnBoot();
  warnAboutInsecureDefaults();

  const app = createApp();
  const server = http.createServer(app);
  const io = initRealtime(server);

  server.listen(env.PORT, () => {
    logger.info('Server listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      storage: env.STORAGE_DRIVER,
    });
  });

  // Housekeeping: expired sessions and uploads that were never sent.
  const housekeeping = setInterval(() => {
    void purgeExpiredSessions()
      .then((count) => count > 0 && logger.info('Purged expired sessions', { count }))
      .catch((error: Error) => logger.error('Session purge failed', { error: error.message }));
    void purgeOrphanAttachments()
      .then((count) => count > 0 && logger.info('Purged orphan attachments', { count }))
      .catch((error: Error) => logger.error('Attachment purge failed', { error: error.message }));
  }, 6 * HOUR);
  housekeeping.unref();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    clearInterval(housekeeping);

    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });

    // Order matters. Chat connections are long-lived by design, so waiting for
    // them to end on their own means always hitting the timeout below and
    // exiting non-zero — which a platform reads as a failed shutdown and which
    // makes every rolling deploy take the full grace period.
    void io.close();
    server.closeAllConnections?.();

    // Last resort, so a stuck socket cannot hold the process forever.
    setTimeout(() => {
      logger.warn('Forcing exit: connections did not close in time');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

main().catch((error: Error) => {
  logger.error('Fatal startup error', { error: error.message, stack: error.stack });
  process.exit(1);
});
