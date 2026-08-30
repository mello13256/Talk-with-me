import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSocket, useSocketEvent } from '@/context/SocketContext';
import { useAuth } from '@/context/AuthContext';
import type { Attachment, ConversationStatus, Message, Paginated } from '@/lib/types';

interface SendInput {
  body: string;
  attachments?: Attachment[];
  replyTo?: Message | null;
}

export interface ConversationState {
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  error: string | null;
  status: ConversationStatus;
  typingName: string | null;
  send: (input: SendInput) => Promise<void>;
  retry: (message: Message) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  loadOlder: () => Promise<void>;
  markRead: () => void;
  notifyTyping: (isTyping: boolean) => void;
  reload: () => Promise<void>;
}

const newNonce = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.slice(0, 32);

/** Newest-last ordering, de-duplicated by id. */
function insertSorted(list: Message[], incoming: Message): Message[] {
  if (list.some((message) => message.id === incoming.id)) {
    return list.map((message) => (message.id === incoming.id ? incoming : message));
  }
  const next = [...list, incoming];
  next.sort((a, b) => {
    const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  return next;
}

export function useConversation(
  conversationId: string | null,
  initialStatus: ConversationStatus = 'open',
): ConversationState {
  const { user } = useAuth();
  const { emit, state: socketState } = useSocket();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConversationStatus>(initialStatus);
  const [typingName, setTypingName] = useState<string | null>(null);

  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const lastReadMarked = useRef<string | null>(null);

  // Updated after commit rather than during render: mutating a ref while
  // rendering is not safe under concurrent rendering, and scroll handlers only
  // run after paint anyway.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const load = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await api.get<Paginated<Message>>(
        `/conversations/${conversationId}/messages?limit=40`,
      );
      setMessages(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível carregar a conversa.',
      );
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    lastReadMarked.current = null;
    void load();
  }, [load]);

  // Joining the room is authorized server-side; re-join after every reconnect.
  useEffect(() => {
    if (!conversationId || socketState !== 'online') return;
    emit('conversation:join', { conversationId });
    return () => emit('conversation:leave', { conversationId });
  }, [conversationId, socketState, emit]);

  // A reconnect may have missed messages while offline — resync the thread.
  const wasOffline = useRef(false);
  useEffect(() => {
    if (socketState === 'offline') wasOffline.current = true;
    if (socketState === 'online' && wasOffline.current) {
      wasOffline.current = false;
      void load();
    }
  }, [socketState, load]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.get<Paginated<Message>>(
        `/conversations/${conversationId}/messages?limit=40&before=${encodeURIComponent(cursor)}`,
      );
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...page.items.filter((message) => !known.has(message.id)), ...current];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      /* keep what is already on screen; the user can scroll again */
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, cursor, loadingOlder]);

  /**
   * Called from scroll and visibility handlers, so it must be cheap and
   * idempotent: it only reaches the server when a message that is actually
   * addressed to us is still unread, and never twice for the same one.
   */
  const markRead = useCallback(() => {
    if (!conversationId) return;
    const newestUnread = messagesRef.current
      .filter(
        (message) =>
          !message.readAt &&
          !message.deletedAt &&
          !message.pending &&
          message.senderId !== user?.id,
      )
      .at(-1);
    if (!newestUnread || lastReadMarked.current === newestUnread.id) return;

    lastReadMarked.current = newestUnread.id;

    if (socketState === 'online') {
      // The socket handler performs the same write and broadcasts the receipt.
      emit('conversation:read', { conversationId });
      return;
    }
    // Offline: fall back to HTTP so the receipt is not simply lost.
    void api.post(`/conversations/${conversationId}/read`).catch(() => {
      // Allow a retry on the next scroll or focus event.
      lastReadMarked.current = null;
    });
  }, [conversationId, emit, socketState, user?.id]);

  /* ------------------------------------------------------------------ */
  /* Realtime                                                            */
  /* ------------------------------------------------------------------ */

  useSocketEvent<{ message: Message }>('message:new', ({ message }) => {
    if (message.conversationId !== conversationId) return;
    setMessages((current) => {
      // Replace our own optimistic copy rather than showing the message twice.
      const optimistic = message.clientNonce
        ? current.findIndex((item) => item.pending && item.clientNonce === message.clientNonce)
        : -1;
      if (optimistic >= 0) {
        const next = [...current];
        next[optimistic] = message;
        return next;
      }
      return insertSorted(current, message);
    });
  });

  useSocketEvent<{ message: Message }>('message:updated', ({ message }) => {
    if (message.conversationId !== conversationId) return;
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? { ...message } : item)),
    );
  });

  useSocketEvent<{ conversationId: string; messageIds: string[]; readAt: string; readerId: string }>(
    'message:read',
    (payload) => {
      if (payload.conversationId !== conversationId) return;
      if (payload.readerId === user?.id) return;
      const ids = new Set(payload.messageIds);
      setMessages((current) =>
        current.map((message) =>
          ids.has(message.id) ? { ...message, readAt: payload.readAt } : message,
        ),
      );
    },
  );

  useSocketEvent<{ conversationId: string; userId: string; name: string; isTyping: boolean }>(
    'typing',
    (payload) => {
      if (payload.conversationId !== conversationId || payload.userId === user?.id) return;
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (!payload.isTyping) {
        setTypingName(null);
        return;
      }
      setTypingName(payload.name);
      // Safety net in case the "stopped typing" event never arrives.
      typingTimer.current = window.setTimeout(() => setTypingName(null), 6000);
    },
  );

  useSocketEvent<{ conversationId: string; status: ConversationStatus }>(
    'conversation:status',
    (payload) => {
      if (payload.conversationId === conversationId) setStatus(payload.status);
    },
  );

  useEffect(
    () => () => {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
    },
    [],
  );

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!conversationId) return;
      const now = Date.now();
      // Throttled: one "typing" event per 2s while the user keeps writing.
      if (isTyping && now - lastTypingSent.current < 2000) return;
      lastTypingSent.current = isTyping ? now : 0;
      emit('typing', { conversationId, isTyping });
    },
    [conversationId, emit],
  );

  /* ------------------------------------------------------------------ */
  /* Sending                                                             */
  /* ------------------------------------------------------------------ */

  const dispatchSend = useCallback(
    async (optimistic: Message, payload: Record<string, unknown>) => {
      if (!conversationId) return;
      try {
        const response = await api.post<{ message: Message }>(
          `/conversations/${conversationId}/messages`,
          payload,
        );
        setMessages((current) => {
          const index = current.findIndex((item) => item.id === optimistic.id);
          if (index < 0) return insertSorted(current, response.message);
          const next = [...current];
          next[index] = response.message;
          return next;
        });
        if (status === 'resolved' && user?.role === 'client') setStatus('open');
      } catch (caught) {
        setMessages((current) =>
          current.map((item) =>
            item.id === optimistic.id ? { ...item, pending: false, failed: true } : item,
          ),
        );
        throw caught;
      }
    },
    [conversationId, status, user?.role],
  );

  const send = useCallback(
    async ({ body, attachments = [], replyTo = null }: SendInput) => {
      if (!conversationId || !user) return;
      const nonce = newNonce();

      // Shown immediately; reconciled with the server copy when it arrives.
      const optimistic: Message = {
        id: `pending-${nonce}`,
        conversationId,
        senderId: user.id,
        senderRole: user.role,
        kind: attachments.length > 0 ? 'file' : 'text',
        body: body.trim(),
        attachments,
        replyTo: replyTo
          ? {
              id: replyTo.id,
              body: replyTo.body,
              senderId: replyTo.senderId,
              senderName: null,
              isDeleted: Boolean(replyTo.deletedAt),
              hasAttachment: replyTo.attachments.length > 0,
            }
          : null,
        clientNonce: nonce,
        readAt: null,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        pending: true,
      };

      setMessages((current) => [...current, optimistic]);
      notifyTyping(false);

      await dispatchSend(optimistic, {
        body: body.trim(),
        attachmentIds: attachments.map((attachment) => attachment.id),
        replyToId: replyTo?.id ?? null,
        clientNonce: nonce,
      });
    },
    [conversationId, user, dispatchSend, notifyTyping],
  );

  const retry = useCallback(
    async (message: Message) => {
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, failed: false, pending: true } : item,
        ),
      );
      // The nonce is reused, so a send that actually succeeded the first time
      // resolves to the same message instead of a duplicate.
      await dispatchSend(message, {
        body: message.body,
        attachmentIds: message.attachments.map((attachment) => attachment.id),
        replyToId: message.replyTo?.id ?? null,
        clientNonce: message.clientNonce ?? newNonce(),
      });
    },
    [dispatchSend],
  );

  const remove = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;
      if (messageId.startsWith('pending-')) {
        setMessages((current) => current.filter((item) => item.id !== messageId));
        return;
      }
      const response = await api.delete<{ message: Message }>(
        `/conversations/${conversationId}/messages/${messageId}`,
      );
      setMessages((current) =>
        current.map((item) => (item.id === messageId ? response.message : item)),
      );
    },
    [conversationId],
  );

  return {
    messages,
    loading,
    loadingOlder,
    hasMore,
    error,
    status,
    typingName,
    send,
    retry,
    remove,
    loadOlder,
    markRead,
    notifyTyping,
    reload: load,
  };
}
