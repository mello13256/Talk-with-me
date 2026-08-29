import webpush from 'web-push';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { query, rows } from '../../db/pool.js';

export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
} else {
  logger.warn('Web Push disabled: VAPID keys not configured');
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  conversationId?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function saveSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string | null,
): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            failure_count = 0,
            last_used_at = now()`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 400) ?? null],
  );
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [
    userId,
    endpoint,
  ]);
}

/**
 * Best-effort fan-out. Endpoints that answer 404/410 are gone for good and are
 * deleted; other failures increment a counter and are dropped after 5 strikes.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!pushEnabled) return;
  const subs = await rows<SubscriptionRow>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 },
        );
        await query(`UPDATE push_subscriptions SET last_used_at = now() WHERE id = $1`, [sub.id]);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
          return;
        }
        await query(
          `UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = $1`,
          [sub.id],
        );
        await query(`DELETE FROM push_subscriptions WHERE id = $1 AND failure_count >= 5`, [sub.id]);
        logger.warn('Web Push delivery failed', { status, error: (error as Error).message });
      }
    }),
  );
}
