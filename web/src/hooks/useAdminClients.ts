import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSocketEvent } from '@/context/SocketContext';
import type { AdminClient, AdminStats } from '@/lib/types';

export type ClientFilter = 'all' | 'unread' | 'online' | 'blocked' | 'open' | 'resolved';
export type ClientSort = 'recent' | 'oldest' | 'name' | 'created' | 'unread';

interface ClientPage {
  items: AdminClient[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface AdminClientsState {
  clients: AdminClient[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  stats: AdminStats | null;
  search: string;
  filter: ClientFilter;
  sort: ClientSort;
  setSearch: (value: string) => void;
  setFilter: (value: ClientFilter) => void;
  setSort: (value: ClientSort) => void;
  loadMore: () => void;
  refresh: () => Promise<void>;
  patchClient: (clientId: string, patch: Partial<AdminClient>) => void;
  removeClient: (clientId: string) => void;
  clearUnread: (conversationId: string) => void;
}

export function useAdminClients(enabled: boolean): AdminClientsState {
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [sort, setSort] = useState<ClientSort>('recent');

  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 260);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (!enabled) return;
      const ticket = ++requestId.current;
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: '30',
          filter,
          sort,
        });
        if (debouncedSearch) params.set('q', debouncedSearch);

        const data = await api.get<ClientPage>(`/admin/clients?${params.toString()}`);
        // A slower earlier request must never overwrite a newer result.
        if (ticket !== requestId.current) return;

        setClients((current) => {
          if (replace) return data.items;
          const known = new Set(current.map((client) => client.id));
          return [...current, ...data.items.filter((client) => !known.has(client.id))];
        });
        setTotal(data.total);
        setHasMore(data.hasMore);
        setPage(targetPage);
      } catch (caught) {
        if (ticket !== requestId.current) return;
        // An empty list and a failed request look identical to the user unless
        // the failure is reported explicitly.
        setError(
          caught instanceof ApiError && caught.status === 429
            ? 'Muitas requisições em sequência. Aguarde alguns segundos.'
            : 'Não foi possível carregar os clientes.',
        );
        if (replace) setClients([]);
      } finally {
        if (ticket === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [enabled, filter, sort, debouncedSearch],
  );

  const refreshStats = useCallback(async () => {
    if (!enabled) return;
    try {
      setStats(await api.get<AdminStats>('/admin/stats'));
    } catch {
      /* the strip keeps its previous numbers */
    }
  }, [enabled]);

  useEffect(() => {
    void fetchPage(1, true);
  }, [fetchPage]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchPage(1, true), refreshStats()]);
  }, [fetchPage, refreshStats]);

  const patchClient = useCallback((clientId: string, patch: Partial<AdminClient>) => {
    setClients((current) =>
      current.map((client) => (client.id === clientId ? { ...client, ...patch } : client)),
    );
  }, []);

  const removeClient = useCallback((clientId: string) => {
    setClients((current) => current.filter((client) => client.id !== clientId));
    setTotal((value) => Math.max(0, value - 1));
  }, []);

  const clearUnread = useCallback((conversationId: string) => {
    setClients((current) =>
      current.map((client) =>
        client.conversationId === conversationId ? { ...client, unreadCount: 0 } : client,
      ),
    );
    setStats((current) =>
      current
        ? { ...current, unansweredConversations: Math.max(0, current.unansweredConversations - 1) }
        : current,
    );
  }, []);

  /* ------------------------------------------------------------------ */
  /* Realtime list updates                                               */
  /* ------------------------------------------------------------------ */

  useSocketEvent<{
    conversationId: string;
    clientId: string;
    lastMessageAt?: string;
    lastMessagePreview?: string;
    unreadCount?: number;
    status?: 'open' | 'resolved';
  }>('conversation:updated', (payload) => {
    setClients((current) => {
      const index = current.findIndex((client) => client.id === payload.clientId);
      if (index < 0) return current;

      const updated: AdminClient = {
        ...current[index]!,
        conversationId: payload.conversationId,
        ...(payload.lastMessageAt ? { lastMessageAt: payload.lastMessageAt } : {}),
        ...(payload.lastMessagePreview
          ? { lastMessagePreview: payload.lastMessagePreview }
          : {}),
        ...(payload.unreadCount !== undefined ? { unreadCount: payload.unreadCount } : {}),
        ...(payload.status ? { conversationStatus: payload.status } : {}),
        ...(payload.lastMessageAt
          ? { messageCount: (current[index]!.messageCount ?? 0) + 1 }
          : {}),
      };

      const next = [...current];
      next.splice(index, 1);
      // With the default sort, activity bubbles the thread to the top.
      return sort === 'recent' && payload.lastMessageAt
        ? [updated, ...next]
        : [...next.slice(0, index), updated, ...next.slice(index)];
    });
  });

  useSocketEvent<{ userId: string; isOnline: boolean; lastSeenAt: string | null }>(
    'presence',
    (payload) => {
      setClients((current) =>
        current.map((client) =>
          client.id === payload.userId
            ? { ...client, isOnline: payload.isOnline, lastSeenAt: payload.lastSeenAt }
            : client,
        ),
      );
      setStats((current) =>
        current
          ? { ...current, online: Math.max(0, current.online + (payload.isOnline ? 1 : -1)) }
          : current,
      );
    },
  );

  useSocketEvent<{ clientId: string }>('client:created', () => void refresh());
  useSocketEvent<{ clientId: string }>('client:deleted', (payload) => removeClient(payload.clientId));
  useSocketEvent<{ clientId: string; isBlocked: boolean }>('client:updated', (payload) =>
    patchClient(payload.clientId, { isBlocked: payload.isBlocked }),
  );

  return {
    clients,
    total,
    loading,
    loadingMore,
    hasMore,
    error,
    stats,
    search,
    filter,
    sort,
    setSearch,
    setFilter,
    setSort,
    loadMore: () => {
      if (!loadingMore && hasMore) void fetchPage(page + 1, false);
    },
    refresh,
    patchClient,
    removeClient,
    clearUnread,
  };
}
