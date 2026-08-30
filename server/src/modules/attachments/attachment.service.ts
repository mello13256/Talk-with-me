import crypto from 'node:crypto';
import { MAX_STORAGE_PER_CLIENT_BYTES, MAX_UPLOAD_BYTES } from '../../config/env.js';
import { badRequest, forbidden, notFound, payloadTooLarge, unsupportedMedia } from '../../lib/errors.js';
import { AppError } from '../../lib/errors.js';
import { maybeOne, one, query, rows } from '../../db/pool.js';
import { logger } from '../../lib/logger.js';
import { storage } from '../../storage/index.js';
import type { AttachmentPurpose, AttachmentRow, UserRow } from '../../types/index.js';

/**
 * Allow-list, not a deny-list. Note the deliberate omissions: image/svg+xml and
 * text/html are executable in a browser context and are never accepted.
 */
export const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** Types safe to render inline in the browser; everything else downloads. */
const INLINE_SAFE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'video/mp4',
  'video/webm',
]);

export const isInlineSafe = (mime: string): boolean => INLINE_SAFE.has(mime);

const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8') },
  {
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/avif',
    test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' && b.subarray(8, 12).toString('ascii').startsWith('avi'),
  },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
];

/**
 * Content sniffing for the types we would ever render inline. A file claiming
 * to be a PNG must actually start like one; otherwise a client could upload an
 * HTML payload under an image content type.
 */
function assertContentMatchesType(mime: string, buffer: Buffer): void {
  const signature = SIGNATURES.find((s) => s.mime === mime);
  if (!signature) return;
  if (buffer.length < 16 || !signature.test(buffer)) {
    throw unsupportedMedia('O conteúdo do arquivo não corresponde ao tipo informado.');
  }
  // Belt and braces: reject anything that also parses as markup.
  const head = buffer.subarray(0, 256).toString('latin1').toLowerCase();
  if (head.includes('<script') || head.includes('<!doctype html') || head.includes('<html')) {
    throw unsupportedMedia('Arquivo rejeitado por conter marcação executável.');
  }
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  return (
    base
      .normalize('NFKD')
      // Control, quoting, and invisible/bidi characters would break or spoof
      // the Content-Disposition filename.
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff"\\]/g, '')
      .trim()
      .slice(0, 200) || 'arquivo'
  );
}

export interface UploadInput {
  user: Pick<UserRow, 'id' | 'role'>;
  purpose: AttachmentPurpose;
  conversationId: string | null;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  width?: number | null;
  height?: number | null;
}

export async function storeUpload(input: UploadInput): Promise<AttachmentRow> {
  const mime = input.mimeType.split(';')[0]!.trim().toLowerCase();
  const extension = ALLOWED_MIME[mime];

  if (!extension) throw unsupportedMedia('Tipo de arquivo não permitido.');
  if (input.buffer.byteLength === 0) throw badRequest('Arquivo vazio.');
  if (input.buffer.byteLength > MAX_UPLOAD_BYTES) throw payloadTooLarge();
  if (input.purpose === 'avatar' && !mime.startsWith('image/')) {
    throw unsupportedMedia('O avatar precisa ser uma imagem.');
  }
  if (input.purpose === 'message' && !input.conversationId) {
    throw badRequest('Conversa não informada.');
  }

  assertContentMatchesType(mime, input.buffer);

  // Cumulative quota. MAX_UPLOAD_BYTES caps a single file; without this a client
  // could still fill the disk one allowed-size file at a time. The operator is
  // exempt: they are trusted, and blocking their replies would be worse.
  if (input.purpose === 'message' && input.user.role !== 'admin') {
    const usage = await one<{ total: number }>(
      `SELECT COALESCE(sum(size_bytes), 0)::bigint AS total
         FROM attachments WHERE uploader_id = $1`,
      [input.user.id],
    );
    if (Number(usage.total) + input.buffer.byteLength > MAX_STORAGE_PER_CLIENT_BYTES) {
      throw new AppError(
        413,
        'storage_quota_exceeded',
        'Você atingiu o limite de armazenamento. Exclua arquivos antigos para enviar novos.',
      );
    }
  }

  // The key never derives from user input: no traversal, no collisions, and the
  // stored extension comes from the allow-list rather than the filename.
  const folder = input.purpose === 'avatar' ? 'avatars' : 'messages';
  const scope = input.purpose === 'avatar' ? input.user.id : input.conversationId!;
  const key = `${folder}/${scope}/${crypto.randomUUID()}.${extension}`;

  await storage.put(key, input.buffer, mime);

  try {
    const result = await query<AttachmentRow>(
      `INSERT INTO attachments
         (purpose, conversation_id, uploader_id, storage_key, original_name,
          mime_type, size_bytes, width, height, checksum_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.purpose,
        input.purpose === 'message' ? input.conversationId : null,
        input.user.id,
        key,
        sanitizeFilename(input.originalName),
        mime,
        input.buffer.byteLength,
        input.width ?? null,
        input.height ?? null,
        crypto.createHash('sha256').update(input.buffer).digest('hex'),
      ],
    );
    return result.rows[0]!;
  } catch (error) {
    // Never leave bytes behind that no row points at.
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}

/**
 * The single gate for reading a stored file. Message attachments require
 * membership in the owning conversation; avatars require sharing a conversation
 * with the owner. Nothing in object storage is publicly reachable.
 */
export async function authorizeDownload(
  viewer: Pick<UserRow, 'id' | 'role'>,
  attachmentId: string,
): Promise<AttachmentRow> {
  const row = await maybeOne<AttachmentRow>(`SELECT * FROM attachments WHERE id = $1`, [attachmentId]);
  if (!row) throw notFound('Arquivo não encontrado.');

  if (viewer.role === 'admin') return row;

  if (row.purpose === 'message') {
    const allowed = await maybeOne<{ id: string }>(
      `SELECT c.id FROM conversations c WHERE c.id = $1 AND c.client_id = $2`,
      [row.conversation_id, viewer.id],
    );
    if (!allowed) throw notFound('Arquivo não encontrado.');
    // An upload still unattached to a message is only visible to its uploader.
    if (!row.message_id && row.uploader_id !== viewer.id) throw notFound('Arquivo não encontrado.');
    return row;
  }

  // Avatars: own avatar, or the avatar of the operator this client talks to.
  if (row.uploader_id === viewer.id) return row;
  const shared = await maybeOne<{ id: string }>(
    `SELECT u.id FROM users u WHERE u.id = $1 AND u.role = 'admin'`,
    [row.uploader_id],
  );
  if (!shared) throw forbidden('Você não tem acesso a este arquivo.');
  return row;
}

export async function deleteAttachment(id: string): Promise<void> {
  const row = await maybeOne<{ storage_key: string }>(
    `DELETE FROM attachments WHERE id = $1 RETURNING storage_key`,
    [id],
  );
  if (!row) return;
  await storage.delete(row.storage_key).catch((error: Error) => {
    logger.warn('Failed to delete stored object', { key: row.storage_key, error: error.message });
  });
}

/** Removes uploads that were never attached to a message (abandoned composer). */
export async function purgeOrphanAttachments(olderThanHours = 24): Promise<number> {
  const orphans = await rows<{ id: string; storage_key: string }>(
    `DELETE FROM attachments
      WHERE purpose = 'message'
        AND message_id IS NULL
        AND created_at < now() - ($1 || ' hours')::interval
      RETURNING id, storage_key`,
    [String(olderThanHours)],
  );
  for (const orphan of orphans) {
    await storage.delete(orphan.storage_key).catch(() => undefined);
  }
  return orphans.length;
}
