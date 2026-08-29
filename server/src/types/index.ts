export type UserRole = 'client' | 'admin';
export type ConversationStatus = 'open' | 'resolved';
export type MessageKind = 'text' | 'file' | 'system';
export type AttachmentPurpose = 'message' | 'avatar';
export type NotificationType =
  | 'message'
  | 'conversation_resolved'
  | 'conversation_reopened'
  | 'account_blocked'
  | 'account_unblocked';

/* -------------------------------------------------------------------------- */
/* Database row shapes                                                        */
/* -------------------------------------------------------------------------- */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  avatar_attachment_id: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  is_blocked: boolean;
  blocked_at: Date | null;
  blocked_reason: string | null;
  is_online: boolean;
  last_seen_at: Date | null;
  password_changed_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: Buffer;
  user_agent: string | null;
  ip: string | null;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface ConversationRow {
  id: string;
  client_id: string;
  status: ConversationStatus;
  subject: string | null;
  last_message_at: Date | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  kind: MessageKind;
  body: string;
  reply_to_id: string | null;
  client_nonce: string | null;
  read_at: Date | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export interface AttachmentRow {
  id: string;
  purpose: AttachmentPurpose;
  conversation_id: string | null;
  message_id: string | null;
  uploader_id: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  checksum_sha256: string | null;
  created_at: Date;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  conversation_id: string | null;
  message_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

/* -------------------------------------------------------------------------- */
/* API DTOs — what actually crosses the wire                                  */
/* -------------------------------------------------------------------------- */

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  phone: string | null;
  company: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Client-facing view of the administrator: no email, no contact details. */
export interface PublicAgent {
  id: string;
  name: string;
  avatarUrl: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
}

export interface AdminClientView extends PublicUser {
  isBlocked: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
  notes: string | null;
  conversationId: string | null;
  conversationStatus: ConversationStatus | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  messageCount: number;
}

export interface AttachmentDTO {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  isImage: boolean;
  url: string;
  createdAt: string;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderRole: UserRole | null;
  kind: MessageKind;
  body: string;
  attachments: AttachmentDTO[];
  replyTo: {
    id: string;
    body: string;
    senderId: string | null;
    senderName: string | null;
    isDeleted: boolean;
    hasAttachment: boolean;
  } | null;
  clientNonce: string | null;
  readAt: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ConversationDTO {
  id: string;
  clientId: string;
  status: ConversationStatus;
  subject: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  conversationId: string | null;
  messageId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
