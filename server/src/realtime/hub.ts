import type { Server as IOServer } from 'socket.io';
import { logger } from '../lib/logger.js';
import { query } from '../db/pool.js';

let io: IOServer | null = null;

export function setIo(server: IOServer): void {
  io = server;
}

export function getIo(): IOServer | null {
  return io;
}

export const userRoom = (userId: string) => `user:${userId}`;
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;
export const ADMIN_ROOM = 'role:admin';

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToConversation(conversationId: string, event: string, payload: unknown): void {
  io?.to(conversationRoom(conversationId)).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown): void {
  io?.to(ADMIN_ROOM).emit(event, payload);
}

export function emitToAll(event: string, payload: unknown): void {
  io?.emit(event, payload);
}

/** Socket.IO de-duplicates across rooms, so a member of two rooms gets one copy. */
export function emitToRooms(roomNames: string[], event: string, payload: unknown): void {
  if (!io || roomNames.length === 0) return;
  let channel = io.to(roomNames[0]!);
  for (const room of roomNames.slice(1)) channel = channel.to(room);
  channel.emit(event, payload);
}

/** Forces every open tab of a user to drop its session (block / delete / logout-all). */
export function disconnectUser(userId: string, reason: string): void {
  emitToUser(userId, 'session:revoked', { reason });
  const sockets = io?.sockets.adapter.rooms.get(userRoom(userId));
  if (!sockets) return;
  for (const socketId of sockets) {
    io?.sockets.sockets.get(socketId)?.disconnect(true);
  }
}

/* -------------------------------------------------------------------------- */
/* Presence                                                                   */
/* -------------------------------------------------------------------------- */

// socket ids per user; a user is online while they hold at least one socket.
const connections = new Map<string, Set<string>>();

export function isUserOnline(userId: string): boolean {
  return (connections.get(userId)?.size ?? 0) > 0;
}

export function onlineUserIds(): string[] {
  return [...connections.keys()];
}

export interface PresencePayload {
  userId: string;
  role: 'client' | 'admin';
  isOnline: boolean;
  lastSeenAt: string | null;
}

async function persistPresence(userId: string, isOnline: boolean): Promise<Date | null> {
  const result = await query<{ last_seen_at: Date | null }>(
    `UPDATE users
        SET is_online = $2,
            last_seen_at = CASE WHEN $2 THEN last_seen_at ELSE now() END
      WHERE id = $1
      RETURNING last_seen_at`,
    [userId, isOnline],
  );
  return result.rows[0]?.last_seen_at ?? null;
}

function broadcastPresence(payload: PresencePayload): void {
  if (payload.role === 'admin') {
    // Every client legitimately needs to know whether the operator is available.
    emitToAll('presence', payload);
  } else {
    // A client's presence is only ever visible to the administrator.
    emitToAdmins('presence', payload);
  }
}

export async function registerConnection(
  userId: string,
  role: 'client' | 'admin',
  socketId: string,
): Promise<void> {
  const set = connections.get(userId) ?? new Set<string>();
  const wasOffline = set.size === 0;
  set.add(socketId);
  connections.set(userId, set);
  if (!wasOffline) return;
  try {
    await persistPresence(userId, true);
    broadcastPresence({ userId, role, isOnline: true, lastSeenAt: null });
  } catch (error) {
    logger.error('Failed to persist presence (online)', { userId, error: (error as Error).message });
  }
}

export async function unregisterConnection(
  userId: string,
  role: 'client' | 'admin',
  socketId: string,
): Promise<void> {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size > 0) return;
  connections.delete(userId);
  try {
    const lastSeenAt = await persistPresence(userId, false);
    broadcastPresence({
      userId,
      role,
      isOnline: false,
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to persist presence (offline)', { userId, error: (error as Error).message });
  }
}

/**
 * Clears stale `is_online` flags left behind by an unclean shutdown. Runs once
 * at boot; safe because a live socket re-registers presence immediately.
 */
export async function resetPresenceOnBoot(): Promise<void> {
  await query(`UPDATE users SET is_online = false WHERE is_online = true`);
  connections.clear();
}
