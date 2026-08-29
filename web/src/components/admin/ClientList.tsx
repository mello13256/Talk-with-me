import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import type { AdminClient } from '@/lib/types';
import type { AdminClientsState, ClientFilter } from '@/hooks/useAdminClients';
import { Avatar } from '@/components/ui/Avatar';
import { CountBadge } from '@/components/ui/Badge';
import { ConversationSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { Button, IconButton } from '@/components/ui/Button';
import { AlertIcon, PlusIcon, SearchIcon, UsersIcon, XIcon } from '@/components/ui/icons';

const FILTERS: Array<{ value: ClientFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'unread', label: 'Não respondidas' },
  { value: 'online', label: 'Online' },
  { value: 'open', label: 'Abertas' },
  { value: 'resolved', label: 'Resolvidas' },
  { value: 'blocked', label: 'Bloqueados' },
];

interface ClientListProps {
  state: AdminClientsState;
  selectedConversationId: string | null;
  onSelect: (client: AdminClient) => void;
  onCreate: () => void;
}

export function ClientList({
  state,
  selectedConversationId,
  onSelect,
  onCreate,
}: ClientListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll: the sentinel at the end of the list pulls the next page.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !state.hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) state.loadMore();
      },
      { root: scrollRef.current, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [state.hasMore, state.loadMore, state]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 space-y-3 border-b border-line px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              value={state.search}
              onChange={(event) => state.setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail ou empresa"
              aria-label="Buscar clientes"
              className="h-9.5 w-full rounded-xl border border-line bg-canvas pl-9 pr-8 text-[13.5px] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            {state.search && (
              <button
                type="button"
                onClick={() => state.setSearch('')}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-2 hover:text-ink"
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
          <IconButton label="Novo cliente" variant="secondary" onClick={onCreate}>
            <PlusIcon size={18} />
          </IconButton>
        </div>

        <div className="scroll-area -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => state.setFilter(option.value)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                state.filter === option.value
                  ? 'bg-brand text-brand-ink'
                  : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="scroll-area min-h-0 flex-1 overflow-y-auto">
        {state.loading ? (
          <ConversationSkeleton />
        ) : state.error ? (
          <EmptyState
            icon={<AlertIcon size={22} />}
            title="Não foi possível carregar"
            description={state.error}
            action={
              <Button size="sm" variant="secondary" onClick={() => void state.refresh()}>
                Tentar novamente
              </Button>
            }
          />
        ) : state.clients.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={22} />}
            title={state.search ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda'}
            description={
              state.search
                ? 'Tente outro termo ou limpe os filtros.'
                : 'Assim que alguém criar uma conta, a conversa aparece aqui.'
            }
            action={
              !state.search ? (
                <Button size="sm" variant="secondary" icon={<PlusIcon size={15} />} onClick={onCreate}>
                  Criar cliente
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="p-1.5">
            {state.clients.map((client) => {
              const active = client.conversationId === selectedConversationId;
              return (
                <li key={client.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(client)}
                    aria-current={active || undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
                      active ? 'bg-brand-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <Avatar
                      name={client.name}
                      seed={client.id}
                      src={client.avatarUrl}
                      size="md"
                      online={client.isOnline}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p
                          className={cn(
                            'truncate text-[14px]',
                            client.unreadCount > 0 ? 'font-semibold text-ink' : 'font-medium text-ink',
                          )}
                        >
                          {client.name}
                        </p>
                        <span className="ml-auto shrink-0 text-[11px] text-ink-subtle">
                          {formatRelative(client.lastMessageAt)}
                        </span>
                      </div>

                      <div className="mt-0.5 flex items-center gap-2">
                        <p
                          className={cn(
                            'truncate text-[12.5px]',
                            client.unreadCount > 0 ? 'font-medium text-ink' : 'text-ink-muted',
                          )}
                        >
                          {client.lastMessagePreview ?? 'Sem mensagens ainda'}
                        </p>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {client.isBlocked && (
                            <span className="h-1.5 w-1.5 rounded-full bg-danger" title="Bloqueado" />
                          )}
                          {client.conversationStatus === 'resolved' && client.unreadCount === 0 && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-success"
                              title="Resolvida"
                            />
                          )}
                          <CountBadge count={client.unreadCount} />
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}

            <div ref={sentinelRef} className="h-px" />
            {state.loadingMore && (
              <li className="flex justify-center py-4">
                <Spinner className="text-ink-subtle" />
              </li>
            )}
          </ul>
        )}
      </div>

      <footer className="shrink-0 border-t border-line px-3.5 py-2 text-[11.5px] text-ink-subtle">
        {state.total} {state.total === 1 ? 'cliente' : 'clientes'}
        {state.stats ? ` · ${state.stats.online} online` : ''}
      </footer>
    </div>
  );
}
