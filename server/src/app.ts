import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env, isProduction } from './config/env.js';
import { logger } from './lib/logger.js';
import { loadSession } from './middleware/auth.js';
import { verifyCsrf } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { conversationRouter } from './modules/conversations/conversation.routes.js';
import { attachmentRouter } from './modules/attachments/attachment.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function resolveWebDist(): string | null {
  const candidates = [
    path.resolve(here, '../../web/dist'),
    path.resolve(here, '../../../web/dist'),
    path.resolve(process.cwd(), 'web/dist'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? null;
}

export function createApp(): Express {
  const app = express();

  // Required for correct client IPs (rate limiting, audit) behind a proxy.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'script-src': ["'self'"],
          // Vite injects a handful of inline style attributes; scripts are not
          // granted the same relaxation.
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'manifest-src': ["'self'"],
          'worker-src': ["'self'"],
          ...(isProduction ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      // Matches the CSP frame-ancestors directive above for older browsers.
      frameguard: { action: 'deny' },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,
    }),
  );

  // Same-origin by default. CORS_ORIGINS is only needed when the SPA is hosted
  // on a different domain than the API.
  if (env.CORS_ORIGINS.length > 0) {
    app.use(
      cors({
        origin: env.CORS_ORIGINS,
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      }),
    );
  }

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  // Order matters: identify the caller, throttle, then verify CSRF.
  app.use('/api', loadSession, globalLimiter, verifyCsrf);

  app.use('/api/auth', authRouter);
  app.use('/api/me', userRouter);
  app.use('/api/conversations', conversationRouter);
  app.use('/api/attachments', attachmentRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', notFoundHandler);

  const webDist = resolveWebDist();
  if (webDist) {
    logger.info('Serving SPA', { dir: webDist });
    app.use(
      express.static(webDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          // Hashed assets are immutable; HTML must always be revalidated.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
