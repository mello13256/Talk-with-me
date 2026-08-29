import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { maybeOne, query, rows, withTransaction, type Tx } from '../../db/pool.js';
import * as db from '../../db/pool.js';
import { toMessageDTO, type MessageRowWithJoins } from '../../lib/serializers.js';
import { unreadPredicate } from '../conversations/conversation.service.js';
import { storage } from '../../storage/index.js';
import { logger } from '../../lib/logger.js';
import type {
  AttachmentRow,
  ConversationRow,
  MessageDTO,
  Paginated,
  UserRow,
} from '../../types/index.js';

type Queryable = Pick<Tx, 'one' | 'maybeOne' | 'rows' | 'query'>;
const root: Queryable = db;

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.body, m.reply_to_id,
         m.client_nonce, m.read_at, m.created_at, m.edited_at, m.deleted_at, m.deleted_by,
         sender.role AS sender_role,
         reply.body AS reply_body,
         reply.sender_id AS reply_sender_id,
         reply.deleted_at AS reply_deleted_at,
         reply_sender.name AS reply_sender_name,
         EXISTS (SELECT 1 FROM attachments ra WHERE ra.message_id = reply.id) AS reply_has_attachment
    FROM messages m
    LEFT JOIN users sender ON sender.id = m.sender_id
    LEFT JOIN messages reply ON reply.id = m.reply_to_id
    LEFT JOIN users reply_sender ON reply_sender.id = reply.sender_id
`;

/* -------------------------------------------------------------------------- */
/* Cursor helpers — keyset pagination on (created_at, id)                      */
/* -------------------------------------------------------------------------- */

export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(row: { created_at: Date; id: string }): string {
  return Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`).toString('base64url');
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const [createdAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

async function attachmentsFor(messageIds: string[], q: Queryable = root): Promise<Map<string, AttachmentRow[]>> {
  const map = new Map<string, AttachmentRow[]>();
  if (messageIds.length === 0) return map;
  const list = await q.rows<AttachmentRow>(
    `SELECT * FROM attachments WHERE message_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
    [messageIds],
  );
  for (const row of list) {
    if (!row.message_id) continue;
    const bucket = map.get(row.message_id) ?? [];
    bucket.push(row);
    map.set(row.message_id, bucket);
  }
  return map;
}

async function hydrate(list: MessageRowWithJoins[], q: Queryable = root): Promise<MessageDTO[]> {
  const attachments = await attachmentsFor(
    list.filter((m) => !m.deleted_at).map((m) => m.id),
    q,
  );
  return list.map((row) => toMessageDTO(row, attachments.get(row.id) ?? []));
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Newest-first page. `before` walks further back in history. */
export async function listMessages(
  conversationId: string,
  options: { before?: string | null; limit?: number } = {},
): Promise<Paginated<MessageDTO>> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const cursor = decodeCursor(options.before);

  const list = await rows<MessageRowWithJoins>(
    `${MESSAGE_SELECT}
      WHERE m.conversation_id = $1
        AND ($2::timestamptz IS NULL
             OR m.created_at < $2::timestamptz
             OR (m.created_at = $2::timestamptz AND m.id < $3::uuid))
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $4`,
    [conversationId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
  );

  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  const items = await hydrate(page);

  return {
    // Oldest-first so the UI can append without reversing.
    items: items.reverse(),
    nextCursor: hasMore && page.at(-1) ? encodeCursor(page.at(-1)!) : null,
    hasMore,
  };
}

export async function getMessageById(id: string): Promise<MessageDTO | null> {
  const row = await maybeOne<MessageRowWithJoins>(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
  if (!row) return null;
  const [dto] = await hydrate([row]);
  return dto ?? null;
}

export async function searchInConversation(
  conversationId: string,
  term: string,
  limit = 30,
): Promise<MessageDTO[]> {
  const list = await rows<MessageRowWithJoins>(
    `${MESSAGE_SELECT}
      WHERE m.conversation_id = $1
        AND m.deleted_at IS NULL
        AND (m.search_vector @@ plainto_tsquery('portuguese', $2) OR m.body ILIKE '%' || $2 || '%')
      ORDER BY m.created_at DESC
      LIMIT $3`,
    [conversationId, term, Math.min(Math.max(limit, 1), 50)],
  );
  return hydrate(list);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateMessageInput {
  conversation: ConversationRow;
  sender: Pick<UserRow, 'id' | 'role'>;
  body: string;
  attachmentIds?: string[];
  replyToId?: string | null;
  clientNonce?: string | null;
}

export async function createMessage(input: CreateMessageInput): Promise<{
  message: MessageDTO;
  deduplicated: boolean;
}> {
  const body = input.body.trim();
  const attachmentIds = input.attachmentIds ?? [];

  if (!body && attachmentIds.length === 0) {
    throw badRequest('Escreva uma mensagem ou anexe um arquivo.');
  }
  if (attachmentIds.length > 10) {
    throw badRequest('Envie no máximo 10 arquivos por mensagem.');
  }

  // Retrying a send with the same nonce returns the original message instead of
  // creating a duplicate — the network can drop the response, not the write.
  if (input.clientNonce) {
    const existing = await maybeOne<MessageRowWithJoins>(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.sender_id = $2 AND m.client_nonce = $3`,
      [input.conversation.id, input.sender.id, input.clientNonce],
    );
    if (existing) {
      const [dto] = await hydrate([existing]);
      return { message: dto!, deduplicated: true };
    }
  }

  return withTransaction(async (tx) => {
    let replyToId: string | null = null;
    if (input.replyToId) {
      // A reply target must live in the same conversation — this is what stops a
      // crafted reply_to_id from leaking a snippet of somebody else's thread.
      const target = await tx.maybeOne<{ id: string }>(
        `SELECT id FROM messages WHERE id = $1 AND conversation_id = $2`,
        [input.replyToId, input.conversation.id],
      );
      if (!target) throw badRequest('A mensagem respondida não existe nesta conversa.');
      replyToId = target.id;
    }

    let claimed: AttachmentRow[] = [];
    if (attachmentIds.length > 0) {
      // Claims only attachments that this uploader created for this conversation
      // and that are not already bound to a message.
      claimed = await tx.rows<AttachmentRow>(
        `SELECT * FROM attachments
          WHERE id = ANY($1::uuid[])
            AND uploader_id = $2
            AND conversation_id = $3
            AND purpose = 'message'
            AND message_id IS NULL
          FOR UPDATE`,
        [attachmentIds, input.sender.id, input.conversation.id],
      );
      if (claimed.length !== attachmentIds.length) {
        throw badRequest('Um ou mais anexos são inválidos ou já foram enviados.');
      }
    }

    const inserted = await tx.one<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_id, kind, body, reply_to_id, client_nonce)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.conversation.id,
        input.sender.id,
        claimed.length > 0 ? 'file' : 'text',
        body,
        replyToId,
        input.clientNonce ?? null,
      ],
    );

    if (claimed.length > 0) {
      await tx.query(`UPDATE attachments SET message_id = $1 WHERE id = ANY($2::uuid[])`, [
        inserted.id,
        claimed.map((a) => a.id),
      ]);
    }

    // A client writing into a resolved thread reopens it automatically.
    if (input.conversation.status === 'resolved' && input.sender.role === 'client') {
      await tx.query(
        `UPDATE conversations SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = $1`,
        [input.conversation.id],
      );
    }

    const row = await tx.one<MessageRowWithJoins>(`${MESSAGE_SELECT} WHERE m.id = $1`, [inserted.id]);
    const [dto] = await hydrate([row], tx);
    return { message: dto!, deduplicated: false };
  });
}

export async function createSystemMessage(
  conversationId: string,
  body: string,
): Promise<MessageDTO> {
  const inserted = await root.one<{ id: string }>(
    `INSERT INTO messages (conversation_id, sender_id, kind, body)
     VALUES ($1, NULL, 'system', $2)
     RETURNING id`,
    [conversationId, body.slice(0, 8000)],
  );
  const row = await root.one<MessageRowWithJoins>(`${MESSAGE_SELECT} WHERE m.id = $1`, [inserted.id]);
  const [dto] = await hydrate([row]);
  return dto!;
}

export interface MarkReadResult {
  messageIds: string[];
  readAt: string | null;
}

/**
 * Marks everything addressed to `reader` in this conversation as read. Which
 * rows those are is decided by `unreadPredicate`, evaluated against the
 * conversation's own client_id rather than any client-supplied value.
 */
export async function markConversationRead(
  conversationId: string,
  readerRole: 'client' | 'admin',
): Promise<MarkReadResult> {
  const updated = await rows<{ id: string; read_at: Date }>(
    `UPDATE messages AS target
        SET read_at = now()
       FROM conversations c
      WHERE c.id = target.conversation_id
        AND target.conversation_id = $1
        AND target.read_at IS NULL
        AND target.deleted_at IS NULL
        AND ${unreadPredicate(readerRole, 'target')}
      RETURNING target.id, target.read_at`,
    [conversationId],
  );
  return {
    messageIds: updated.map((r) => r.id),
    readAt: updated[0] ? new Date(updated[0].read_at).toISOString() : null,
  };
}

export async function softDeleteMessage(
  messageId: string,
  actor: Pick<UserRow, 'id' | 'role'>,
  conversationId: string,
): Promise<MessageDTO> {
  const target = await maybeOne<{ id: string; sender_id: string | null; deleted_at: Date | null }>(
    `SELECT id, sender_id, deleted_at FROM messages WHERE id = $1 AND conversation_id = $2`,
    [messageId, conversationId],
  );
  if (!target) throw notFound('Mensagem não encontrada.');
  if (target.deleted_at) throw badRequest('Esta mensagem já foi excluída.');

  const isOwner = target.sender_id === actor.id;
  if (!isOwner && actor.role !== 'admin') {
    throw forbidden('Você só pode excluir suas próprias mensagens.');
  }

  const orphaned = await rows<{ storage_key: string }>(
    `SELECT storage_key FROM attachments WHERE message_id = $1`,
    [messageId],
  );

  await query(
    `UPDATE messages SET deleted_at = now(), deleted_by = $2, body = '' WHERE id = $1`,
    [messageId, actor.id],
  );
  // Metadata goes first so the download endpoint stops resolving immediately;
  // the bytes are then removed from object storage on a best-effort basis.
  await query(`DELETE FROM attachments WHERE message_id = $1`, [messageId]);
  for (const { storage_key } of orphaned) {
    void storage.delete(storage_key).catch((error: Error) => {
      logger.warn('Failed to delete stored object', { key: storage_key, error: error.message });
    });
  }

  const row = await root.one<MessageRowWithJoins>(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId]);
  const [dto] = await hydrate([row]);
  return dto!;
}

export async function countMessages(conversationId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL`,
    [conversationId],
  );
  return result.rows[0]?.count ?? 0;
}
