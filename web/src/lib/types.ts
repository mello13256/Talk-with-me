export type UserRole = 'client' | 'admin';
export type ConversationStatus = 'open' | 'resolved';
export type MessageKind = 'text' | 'file' | 'system';

export interface User {
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

export interface Agent {
  id: string;
  name: string;
  avatarUrl: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
}

export interface AdminClient extends User {
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

export interface Attachment {
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

export interface ReplyPreview {
  id: string;
  body: string;
  senderId: string | null;
  senderName: string | null;
  isDeleted: boolean;
  hasAttachment: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderRole: UserRole | null;
  kind: MessageKind;
  body: string;
  attachments: Attachment[];
  replyTo: ReplyPreview | null;
  clientNonce: string | null;
  readAt: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Client-only: set while an optimistic message is in flight or has failed. */
  pending?: boolean;
  failed?: boolean;
}

export interface Conversation {
  id: string;
  clientId: string;
  status: ConversationStatus;
  subject: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface Notification {
  id: string;
  type: string;
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

export interface AdminStats {
  clients: number;
  online: number;
  blocked: number;
  openConversations: number;
  unansweredConversations: number;
  messagesLast24h: number;
  unreadMessages: number;
}

export interface MessageSearchHit {
  id: string;
  conversationId: string;
  clientId: string;
  clientName: string;
  body: string;
  senderId: string | null;
  senderRole: UserRole | null;
  createdAt: string;
}
