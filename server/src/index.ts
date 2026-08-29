import http from 'node:http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { checkDatabase, closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './app.js';
import { initRealtime } from './realtime/socket.js';
import { resetPresenceOnBoot } from './realtime/hub.js';
import { purgeExpiredSessions } from './modules/auth/session.service.js';
import { purgeOrphanAttachments } from './modules/attachments/attachment.service.js';

const HOUR = 60 * 60 * 1000;

async function main(): Promise<void> {
  await checkDatabase();
  await runMigrations();
  await resetPresenceOnBoot();

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
    void io.close(() => undefined);
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
    // Never hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
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
