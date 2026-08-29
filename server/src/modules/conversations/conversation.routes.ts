import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { forbidden } from '../../lib/errors.js';
import { toConversationDTO, toPublicAgent, toPublicUser } from '../../lib/serializers.js';
import * as v from '../../lib/validation.js';
import { maybeOne } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth } from '../../middleware/auth.js';
import { messageLimiter, searchLimiter } from '../../middleware/rate-limit.js';
import {
  ADMIN_ROOM,
  conversationRoom,
  emitToAdmins,
  emitToRooms,
  emitToUser,
  isUserOnline,
  userRoom,
} from '../../realtime/hub.js';
import {
  createMessage,
  listMessages,
  markConversationRead,
  searchInConversation,
  softDeleteMessage,
} from '../messages/message.service.js';
import {
  dismissConversationNotifications,
  notifyNewMessage,
} from '../notifications/notification.service.js';
import type { ConversationRow, MessageDTO, UserRow } from '../../types/index.js';
import {
  authorizeConversation,
  countUnread,
  ensureConversationForClient,
  getPrimaryAgent,
} from './conversation.service.js';

export const conversationRouter = Router();

conversationRouter.use(requireAuth);

const idParam = z.object({ id: v.uuid });

/** Short plain-text summary used for notification bodies and sidebar previews. */
function previewOf(message: MessageDTO): string {
  if (message.body.trim()) return message.body.trim().replace(/\s+/g, ' ').slice(0, 140);
  if (message.attachments.length > 0) {
    const first = message.attachments[0]!;
    return first.isImage ? 'Enviou uma imagem' : `Enviou um arquivo: ${first.name}`;
  }
  return 'Nova mensagem';
}

/**
 * Single fan-out point for a newly created message: the thread itself, the
 * recipient's personal room (so a closed tab still updates its badge), the
 * operator's conversation list, and the notification record.
 */
async function broadcastNewMessage(params: {
  conversation: ConversationRow;
  sender: UserRow;
  message: MessageDTO;
}): Promise<void> {
  const { conversation, sender, message } = params;
  const senderIsClient = sender.role === 'client';

  const agent = senderIsClient ? await getPrimaryAgent() : null;
  const recipientId = senderIsClient ? (agent?.id ?? null) : conversation.client_id;

  const rooms = [conversationRoom(conversation.id)];
  if (recipientId) rooms.push(userRoom(recipientId));
  rooms.push(userRoom(sender.id));
  emitToRooms(rooms, 'message:new', { message });

  const summary = {
    conversationId: conversation.id,
    clientId: conversation.client_id,
    lastMessageAt: message.createdAt,
    lastMessagePreview: previewOf(message),
    status: senderIsClient && conversation.status === 'resolved' ? 'open' : conversation.status,
  };
  emitToAdmins('conversation:updated', {
    ...summary,
    unreadCount: await countUnread(conversation.id, 'admin'),
  });
  emitToUser(conversation.client_id, 'conversation:updated', {
    ...summary,
    unreadCount: await countUnread(conversation.id, 'client'),
  });

  if (!recipientId) return;

  await notifyNewMessage({
    recipientId,
    conversationId: conversation.id,
    messageId: message.id,
    title: senderIsClient ? sender.name : `${sender.name} respondeu`,
    preview: previewOf(message),
    url: `${env.APP_URL.replace(/\/$/, '')}${
      senderIsClient ? `/admin/conversations/${conversation.id}` : '/chat'
    }`,
    // Push is for people who are not already looking at the app.
    push: !isUserOnline(recipientId),
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** The signed-in client's own thread. Created on demand if it does not exist. */
conversationRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    if (user.role !== 'client') throw forbidden('Esta rota é exclusiva para clientes.');

    const conversation = await ensureConversationForClient(user.id);
    const [unread, agent] = await Promise.all([
      countUnread(conversation.id, 'client'),
      getPrimaryAgent(),
    ]);

    res.json({
      conversation: toConversationDTO(conversation, unread),
      agent: agent ? toPublicAgent(agent) : null,
    });
  }),
);

conversationRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const viewer = req.auth!.user;
    const conversation = await authorizeConversation(viewer, id);
    const unread = await countUnread(conversation.id, viewer.role);

    const client =
      viewer.role === 'admin'
        ? await maybeOne<UserRow>(`SELECT * FROM users WHERE id = $1`, [conversation.client_id])
        : null;
    const agent = await getPrimaryAgent();

    res.json({
      conversation: toConversationDTO(conversation, unread),
      client: client ? toPublicUser(client) : null,
      agent: agent ? toPublicAgent(agent) : null,
    });
  }),
);

const listQuery = z.object({ before: v.cursor, limit: v.pageLimit });

conversationRouter.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const query = listQuery.parse(req.query);
    // Authorization first: an unauthorized id never reaches the message query.
    const conversation = await authorizeConversation(req.auth!.user, id);
    const page = await listMessages(conversation.id, {
      before: query.before ?? null,
      limit: query.limit ?? 30,
    });
    res.json(page);
  }),
);

conversationRouter.get(
  '/:id/messages/search',
  searchLimiter,
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { q } = z.object({ q: v.searchTerm }).parse(req.query);
    const conversation = await authorizeConversation(req.auth!.user, id);
    const results = await searchInConversation(conversation.id, q);
    res.json({ items: results });
  }),
);

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

const sendSchema = z
  .object({
    body: v.messageBody.default(''),
    attachmentIds: z.array(v.uuid).max(10).optional(),
    replyToId: v.uuid.nullable().optional(),
    clientNonce: z.string().min(8).max(64).optional(),
  })
  .strict();

conversationRouter.post(
  '/:id/messages',
  messageLimiter,
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = sendSchema.parse(req.body);
    const sender = req.auth!.user;
    const conversation = await authorizeConversation(sender, id);

    const { message, deduplicated } = await createMessage({
      conversation,
      sender,
      body: input.body,
      attachmentIds: input.attachmentIds ?? [],
      replyToId: input.replyToId ?? null,
      clientNonce: input.clientNonce ?? null,
    });

    if (!deduplicated) await broadcastNewMessage({ conversation, sender, message });

    res.status(deduplicated ? 200 : 201).json({ message });
  }),
);

conversationRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const reader = req.auth!.user;
    const conversation = await authorizeConversation(reader, id);

    const result = await markConversationRead(conversation.id, reader.role);
    await dismissConversationNotifications(reader.id, conversation.id);

    if (result.messageIds.length > 0) {
      // Tell the other party their messages were seen.
      emitToRooms(
        [conversationRoom(conversation.id), userRoom(conversation.client_id), ADMIN_ROOM],
        'message:read',
        {
          conversationId: conversation.id,
          messageIds: result.messageIds,
          readAt: result.readAt,
          readerId: reader.id,
        },
      );
    }

    res.json({ readCount: result.messageIds.length, readAt: result.readAt });
  }),
);

conversationRouter.delete(
  '/:id/messages/:messageId',
  asyncHandler(async (req, res) => {
    const params = z.object({ id: v.uuid, messageId: v.uuid }).parse(req.params);
    const actor = req.auth!.user;
    const conversation = await authorizeConversation(actor, params.id);

    const message = await softDeleteMessage(params.messageId, actor, conversation.id);

    emitToRooms(
      [conversationRoom(conversation.id), userRoom(conversation.client_id), ADMIN_ROOM],
      'message:updated',
      { message },
    );
    res.json({ message });
  }),
);
