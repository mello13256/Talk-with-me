import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import * as v from '../../lib/validation.js';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
} from './notification.service.js';
import { pushEnabled, removeSubscription, saveSubscription } from './push.service.js';

export const notificationRouter = Router();

/** Public: the VAPID public key is meant to be shipped to the browser. */
notificationRouter.get('/push/public-key', (_req, res) => {
  res.json({ enabled: pushEnabled, publicKey: pushEnabled ? env.VAPID_PUBLIC_KEY : null });
});

notificationRouter.use(requireAuth);

const listQuery = z.object({ cursor: v.cursor, limit: v.pageLimit });

notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { cursor, limit } = listQuery.parse(req.query);
    const page = await listNotifications(req.auth!.user.id, {
      cursor: cursor ?? null,
      limit: limit ?? 20,
    });
    res.json(page);
  }),
);

notificationRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    res.json({ count: await countUnreadNotifications(req.auth!.user.id) });
  }),
);

notificationRouter.post(
  '/read',
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: v.idList.optional() }).parse(req.body ?? {});
    const updated = await markNotificationsRead(req.auth!.user.id, ids);
    res.json({ updated });
  }),
);

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(10).max(300),
    auth: z.string().min(4).max(300),
  }),
});

notificationRouter.post(
  '/push/subscribe',
  asyncHandler(async (req, res) => {
    const subscription = subscriptionSchema.parse(req.body);
    await saveSubscription(req.auth!.user.id, subscription, req.get('user-agent') ?? null);
    res.status(201).json({ ok: true });
  }),
);

notificationRouter.post(
  '/push/unsubscribe',
  asyncHandler(async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().url().max(1000) }).parse(req.body);
    await removeSubscription(req.auth!.user.id, endpoint);
    res.status(204).end();
  }),
);
