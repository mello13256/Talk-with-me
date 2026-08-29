import { notFound } from '../../lib/errors.js';
import { maybeOne, one, type Tx } from '../../db/pool.js';
import * as db from '../../db/pool.js';
import type { ConversationRow, UserRow } from '../../types/index.js';

type Queryable = Pick<Tx, 'one' | 'maybeOne' | 'rows' | 'query'>;
const root: Queryable = db;

const CONVERSATION_COLUMNS = `
  id, client_id, status, subject, last_message_at, resolved_at, resolved_by, created_at, updated_at
`;

/**
 * Each message has exactly one recipient, so "unread for me" is expressible as a
 * single predicate:
 *   - the client's inbox holds everything not written by the client;
 *   - the operator's inbox holds only what the client wrote.
 * System messages therefore land in the client's inbox, which is what we want.
 */
export function unreadPredicate(role: 'client' | 'admin', alias = 'm'): string {
  return role === 'client'
    ? `${alias}.sender_id IS DISTINCT FROM c.client_id`
    : `${alias}.sender_id = c.client_id`;
}

export async function getConversationById(
  id: string,
  q: Queryable = root,
): Promise<ConversationRow | null> {
  return q.maybeOne<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = $1`,
    [id],
  );
}

export async function getConversationByClientId(
  clientId: string,
  q: Queryable = root,
): Promise<ConversationRow | null> {
  return q.maybeOne<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE client_id = $1`,
    [clientId],
  );
}

/**
 * Idempotent: the UNIQUE constraint on client_id makes concurrent creation safe,
 * and ON CONFLICT turns the race into a no-op instead of an error.
 */
export async function ensureConversationForClient(
  clientId: string,
  q: Queryable = root,
): Promise<ConversationRow> {
  await q.query(
    `INSERT INTO conversations (client_id) VALUES ($1) ON CONFLICT (client_id) DO NOTHING`,
    [clientId],
  );
  return q.one<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE client_id = $1`,
    [clientId],
  );
}

/**
 * Authorization for a conversation. For clients the ownership check is part of
 * the WHERE clause, so there is no code path that can read another client's
 * conversation even if a handler forgets a check.
 */
export async function authorizeConversation(
  user: Pick<UserRow, 'id' | 'role'>,
  conversationId: string,
): Promise<ConversationRow> {
  if (user.role === 'admin') {
    const row = await getConversationById(conversationId);
    if (!row) throw notFound('Conversa não encontrada.');
    return row;
  }
  const row = await maybeOne<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = $1 AND client_id = $2`,
    [conversationId, user.id],
  );
  // Deliberately 404, not 403: a client learns nothing about ids that exist.
  if (!row) throw notFound('Conversa não encontrada.');
  return row;
}

export async function countUnread(
  conversationId: string,
  role: 'client' | 'admin',
): Promise<number> {
  const row = await one<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = $1
        AND m.deleted_at IS NULL
        AND m.read_at IS NULL
        AND ${unreadPredicate(role)}`,
    [conversationId],
  );
  return row.count;
}

export async function setConversationStatus(
  conversationId: string,
  status: 'open' | 'resolved',
  actorId: string,
): Promise<ConversationRow> {
  const row = await maybeOne<ConversationRow>(
    `UPDATE conversations
        SET status      = $2::conversation_status,
            resolved_at = CASE WHEN $2::text = 'resolved' THEN now() ELSE NULL END,
            resolved_by = CASE WHEN $2::text = 'resolved' THEN $3::uuid ELSE NULL END
      WHERE id = $1
      RETURNING ${CONVERSATION_COLUMNS}`,
    [conversationId, status, actorId],
  );
  if (!row) throw notFound('Conversa não encontrada.');
  return row;
}

export async function updateSubject(conversationId: string, subject: string | null): Promise<void> {
  await root.query(`UPDATE conversations SET subject = $2 WHERE id = $1`, [conversationId, subject]);
}

/** The operator account clients talk to: the oldest administrator on record. */
export async function getPrimaryAgent(): Promise<UserRow | null> {
  return maybeOne<UserRow>(
    `SELECT * FROM users WHERE role = 'admin' AND is_blocked = false ORDER BY created_at ASC LIMIT 1`,
  );
}
