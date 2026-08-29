import type {
  AdminClientView,
  AttachmentDTO,
  AttachmentRow,
  ConversationDTO,
  ConversationRow,
  MessageDTO,
  MessageRow,
  NotificationDTO,
  NotificationRow,
  PublicAgent,
  PublicUser,
  UserRow,
} from '../types/index.js';

export const IMAGE_MIME = /^image\/(png|jpeg|jpg|gif|webp|avif)$/i;

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

export const attachmentUrl = (id: string): string => `/api/attachments/${id}`;

export function toAvatarUrl(attachmentId: string | null): string | null {
  return attachmentId ? attachmentUrl(attachmentId) : null;
}

/** Full profile — only ever returned to the user themselves or to an admin. */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: toAvatarUrl(row.avatar_attachment_id),
    phone: row.phone,
    company: row.company,
    isOnline: row.is_online,
    lastSeenAt: iso(row.last_seen_at),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Administrator as seen by a client. Deliberately omits e-mail, phone, notes and
 * every other field a client has no business reading.
 */
export function toPublicAgent(row: Pick<UserRow, 'id' | 'name' | 'avatar_attachment_id' | 'is_online' | 'last_seen_at'>): PublicAgent {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: toAvatarUrl(row.avatar_attachment_id),
    isOnline: row.is_online,
    lastSeenAt: iso(row.last_seen_at),
  };
}

export interface AdminClientRow extends UserRow {
  conversation_id: string | null;
  conversation_status: 'open' | 'resolved' | null;
  conversation_last_message_at: Date | null;
  last_message_preview: string | null;
  unread_count: number | string | null;
  message_count: number | string | null;
}

export function toAdminClientView(row: AdminClientRow): AdminClientView {
  return {
    ...toPublicUser(row),
    isBlocked: row.is_blocked,
    blockedAt: iso(row.blocked_at),
    blockedReason: row.blocked_reason,
    notes: row.notes,
    conversationId: row.conversation_id,
    conversationStatus: row.conversation_status,
    lastMessageAt: iso(row.conversation_last_message_at),
    lastMessagePreview: row.last_message_preview,
    unreadCount: Number(row.unread_count ?? 0),
    messageCount: Number(row.message_count ?? 0),
  };
}

export function toConversationDTO(row: ConversationRow, unreadCount = 0): ConversationDTO {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    subject: row.subject,
    createdAt: new Date(row.created_at).toISOString(),
    lastMessageAt: iso(row.last_message_at),
    unreadCount,
  };
}

export function toAttachmentDTO(row: AttachmentRow): AttachmentDTO {
  return {
    id: row.id,
    name: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    isImage: IMAGE_MIME.test(row.mime_type),
    url: attachmentUrl(row.id),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export interface MessageRowWithJoins extends MessageRow {
  sender_role: 'client' | 'admin' | null;
  reply_body: string | null;
  reply_sender_id: string | null;
  reply_sender_name: string | null;
  reply_deleted_at: Date | null;
  reply_has_attachment: boolean | null;
}

export function toMessageDTO(row: MessageRowWithJoins, attachments: AttachmentRow[] = []): MessageDTO {
  const isDeleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    kind: row.kind,
    // A soft-deleted message never ships its original body to any client.
    body: isDeleted ? '' : row.body,
    attachments: isDeleted ? [] : attachments.map(toAttachmentDTO),
    replyTo: row.reply_to_id
      ? {
          id: row.reply_to_id,
          body: row.reply_deleted_at ? '' : (row.reply_body ?? ''),
          senderId: row.reply_sender_id,
          senderName: row.reply_sender_name,
          isDeleted: Boolean(row.reply_deleted_at),
          hasAttachment: Boolean(row.reply_has_attachment),
        }
      : null,
    clientNonce: row.client_nonce,
    readAt: iso(row.read_at),
    createdAt: new Date(row.created_at).toISOString(),
    editedAt: iso(row.edited_at),
    deletedAt: iso(row.deleted_at),
  };
}

export function toNotificationDTO(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    readAt: iso(row.read_at),
    createdAt: new Date(row.created_at).toISOString(),
  };
}
