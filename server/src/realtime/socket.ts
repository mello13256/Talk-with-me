import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type DefaultEventsMap, type Socket } from 'socket.io';
import { z } from 'zod';
import { env, isProduction } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { resolveSessionToken } from '../modules/auth/session.service.js';
import {
  authorizeConversation,
  getConversationByClientId,
} from '../modules/conversations/conversation.service.js';
import { markConversationRead } from '../modules/messages/message.service.js';
import { dismissConversationNotifications } from '../modules/notifications/notification.service.js';
import type { UserRole, UserRow } from '../types/index.js';
import {
  ADMIN_ROOM,
  conversationRoom,
  emitToRooms,
  registerConnection,
  setIo,
  unregisterConnection,
  userRoom,
} from './hub.js';

interface SocketData {
  user: Pick<UserRow, 'id' | 'name' | 'role'>;
  /** Conversation rooms this socket has been authorized to join. */
  joined: Set<string>;
}

type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/** Minimal cookie parser: the handshake gives us a raw header, not req.cookies. */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

const conversationEvent = z.object({ conversationId: z.string().uuid() });
const typingEvent = z.object({ conversationId: z.string().uuid(), isTyping: z.boolean() });

export function initRealtime(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: {
      origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : isProduction ? false : true,
      credentials: true,
    },
    // Roughly matches the client's own reconnect behaviour.
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e6,
  });

  /**
   * The socket handshake carries the same session cookie as HTTP. There is no
   * separate socket token to steal, and a blocked or revoked session is refused
   * here exactly as it is on the REST side.
   */
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const token = cookies[env.SESSION_COOKIE_NAME];
      if (!token) return next(new Error('unauthorized'));

      const resolved = await resolveSessionToken(token);
      if (!resolved) return next(new Error('unauthorized'));

      (socket as AppSocket).data.user = {
        id: resolved.user.id,
        name: resolved.user.name,
        role: resolved.user.role,
      };
      (socket as AppSocket).data.joined = new Set<string>();
      next();
    } catch (error) {
      logger.error('Socket authentication failed', { error: (error as Error).message });
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (raw) => {
    const socket = raw as AppSocket;
    const user = socket.data.user;

    void socket.join(userRoom(user.id));
    if (user.role === 'admin') void socket.join(ADMIN_ROOM);

    void registerConnection(user.id, user.role, socket.id);

    // A client only ever has one thread, so it is joined automatically.
    if (user.role === 'client') {
      void getConversationByClientId(user.id).then((conversation) => {
        if (!conversation) return;
        socket.data.joined.add(conversation.id);
        void socket.join(conversationRoom(conversation.id));
      });
    }

    socket.emit('ready', { userId: user.id, role: user.role as UserRole });

    socket.on('conversation:join', async (payload: unknown, ack?: (result: unknown) => void) => {
      try {
        const { conversationId } = conversationEvent.parse(payload);
        // Authorization is re-checked here; joining a room is not a free pass.
        const conversation = await authorizeConversation(user, conversationId);
        socket.data.joined.add(conversation.id);
        await socket.join(conversationRoom(conversation.id));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'forbidden' });
      }
    });

    socket.on('conversation:leave', async (payload: unknown) => {
      const parsed = conversationEvent.safeParse(payload);
      if (!parsed.success) return;
      socket.data.joined.delete(parsed.data.conversationId);
      await socket.leave(conversationRoom(parsed.data.conversationId));
    });

    socket.on('typing', (payload: unknown) => {
      const parsed = typingEvent.safeParse(payload);
      if (!parsed.success) return;
      // Only rooms this socket already proved access to may be addressed.
      if (!socket.data.joined.has(parsed.data.conversationId)) return;
      socket.to(conversationRoom(parsed.data.conversationId)).emit('typing', {
        conversationId: parsed.data.conversationId,
        userId: user.id,
        name: user.name,
        role: user.role,
        isTyping: parsed.data.isTyping,
      });
      if (user.role === 'client') {
        socket.to(ADMIN_ROOM).emit('typing', {
          conversationId: parsed.data.conversationId,
          userId: user.id,
          name: user.name,
          role: user.role,
          isTyping: parsed.data.isTyping,
        });
      }
    });

    socket.on('conversation:read', async (payload: unknown) => {
      const parsed = conversationEvent.safeParse(payload);
      if (!parsed.success) return;
      try {
        const conversation = await authorizeConversation(user, parsed.data.conversationId);
        const result = await markConversationRead(conversation.id, user.role);
        await dismissConversationNotifications(user.id, conversation.id);
        if (result.messageIds.length === 0) return;
        emitToRooms(
          [conversationRoom(conversation.id), userRoom(conversation.client_id), ADMIN_ROOM],
          'message:read',
          {
            conversationId: conversation.id,
            messageIds: result.messageIds,
            readAt: result.readAt,
            readerId: user.id,
          },
        );
      } catch {
        /* unauthorized reads are silently ignored */
      }
    });

    socket.on('disconnect', () => {
      void unregisterConnection(user.id, user.role, socket.id);
    });
  });

  setIo(io);
  logger.info('Realtime gateway ready');
  return io;
}
