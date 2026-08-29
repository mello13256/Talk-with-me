import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/context/SocketContext';
import { showLocalNotification } from '@/lib/push';
import type { Notification, Paginated } from '@/lib/types';

const BASE_TITLE = 'Talk with me';

export interface NotificationsState {
  items: Notification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
}

export function useNotifications(enabled: boolean): NotificationsState {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const titleRef = useRef(BASE_TITLE);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const [page, count] = await Promise.all([
        api.get<Paginated<Notification>>('/notifications?limit=20'),
        api.get<{ count: number }>('/notifications/unread-count'),
      ]);
      setItems(page.items);
      setUnreadCount(count.count);
    } catch {
      /* the bell simply stays at its previous value */
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  useSocketEvent<Notification>('notification:new', (notification) => {
    setItems((current) => [
      notification,
      ...current.filter((item) => item.id !== notification.id),
    ]);
    setUnreadCount((count) => count + 1);
    // Only when the tab is in the background — an open tab already shows it.
    showLocalNotification(
      notification.title,
      notification.body,
      notification.conversationId ?? undefined,
    );
  });

  // Unread count in the tab title, so a background tab is noticeable.
  useEffect(() => {
    titleRef.current = unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
    document.title = titleRef.current;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [unreadCount]);

  const markAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    setUnreadCount(0);
    setItems((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() })),
    );
    await api.post('/notifications/read', {}).catch(() => undefined);
  }, [unreadCount]);

  const markRead = useCallback(async (id: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    await api.post('/notifications/read', { ids: [id] }).catch(() => undefined);
  }, []);

  return { items, unreadCount, loading, refresh, markAllRead, markRead };
}
