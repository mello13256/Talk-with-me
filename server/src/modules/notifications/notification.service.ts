import { env } from '../../config/env.js';
import { query, rows } from '../../db/pool.js';
import { toNotificationDTO } from '../../lib/serializers.js';
import { emitToUser } from '../../realtime/hub.js';
import type { NotificationRow, NotificationType, Paginated, NotificationDTO } from '../../types/index.js';
import { sendPushToUser } from './push.service.js';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  conversationId?: string | null;
  messageId?: string | null;
  /** Deep link used by the service worker when the push notification is clicked. */
  url?: string;
  push?: boolean;
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationDTO> {
  const result = await query<NotificationRow>(
    `INSERT INTO notifications (user_id, type, title, body, conversation_id, message_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.userId,
      input.type,
      input.title.slice(0, 200),
      (input.body ?? '').slice(0, 500),
      input.conversationId ?? null,
      input.messageId ?? null,
    ],
  );
  const row = result.rows[0]!;
  const dto = toNotificationDTO(row);

  emitToUser(input.userId, 'notification:new', dto);

  if (input.push !== false) {
    void sendPushToUser(input.userId, {
      title: dto.title,
      body: dto.body,
      url: input.url ?? `${env.APP_URL}/chat`,
      tag: input.conversationId ? `conversation:${input.conversationId}` : dto.id,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    }).catch(() => undefined);
  }

  return dto;
}

export async function listNotifications(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<Paginated<NotificationDTO>> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const items = await rows<NotificationRow>(
    `SELECT * FROM notifications
      WHERE user_id = $1
        AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
      ORDER BY created_at DESC
      LIMIT $3`,
    [userId, options.cursor ?? null, limit + 1],
  );
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return {
    items: page.map(toNotificationDTO),
    nextCursor: hasMore ? (page.at(-1)?.created_at.toISOString() ?? null) : null,
    hasMore,
  };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const result = await query(
    `UPDATE notifications
        SET read_at = now()
      WHERE user_id = $1
        AND read_at IS NULL
        AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
    [userId, ids && ids.length > 0 ? ids : null],
  );
  return result.rowCount ?? 0;
}

/** Clears message notifications once the conversation has actually been read. */
export async function dismissConversationNotifications(
  userId: string,
  conversationId: string,
): Promise<void> {
  await query(
    `UPDATE notifications
        SET read_at = now()
      WHERE user_id = $1 AND conversation_id = $2 AND read_at IS NULL AND type = 'message'`,
    [userId, conversationId],
  );
}

/**
 * A conversation holds at most one unread "new message" notification, refreshed
 * in place. Without this, a burst of ten messages would produce ten rows and ten
 * push notifications for the same thread.
 */
export async function notifyNewMessage(params: {
  recipientId: string;
  conversationId: string;
  messageId: string;
  title: string;
  preview: string;
  url: string;
  push: boolean;
}): Promise<NotificationDTO> {
  const updated = await query<NotificationRow>(
    `UPDATE notifications
        SET title = $3, body = $4, message_id = $5, created_at = now()
      WHERE user_id = $1
        AND conversation_id = $2
        AND type = 'message'
        AND read_at IS NULL
      RETURNING *`,
    [params.recipientId, params.conversationId, params.title.slice(0, 200), params.preview.slice(0, 500), params.messageId],
  );

  const row =
    updated.rows[0] ??
    (
      await query<NotificationRow>(
        `INSERT INTO notifications (user_id, type, title, body, conversation_id, message_id)
         VALUES ($1, 'message', $2, $3, $4, $5)
         RETURNING *`,
        [
          params.recipientId,
          params.title.slice(0, 200),
          params.preview.slice(0, 500),
          params.conversationId,
          params.messageId,
        ],
      )
    ).rows[0]!;

  const dto = toNotificationDTO(row);
  emitToUser(params.recipientId, 'notification:new', dto);

  if (params.push) {
    void sendPushToUser(params.recipientId, {
      title: params.title,
      body: params.preview,
      url: params.url,
      tag: `conversation:${params.conversationId}`,
      conversationId: params.conversationId,
    }).catch(() => undefined);
  }

  return dto;
}
