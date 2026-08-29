import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import type { NotificationsState } from '@/hooks/useNotifications';
import { IconButton } from '@/components/ui/Button';
import { BellIcon } from '@/components/ui/icons';

interface NotificationBellProps {
  notifications: NotificationsState;
  onOpenConversation?: (conversationId: string) => void;
}

export function NotificationBell({ notifications, onOpenConversation }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        label="Notificações"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void notifications.refresh();
        }}
        className={cn(open && 'bg-surface-2 text-ink')}
      >
        <span className="relative">
          <BellIcon size={19} />
          {notifications.unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" />
          )}
        </span>
      </IconButton>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-[min(22rem,calc(100vw-1.5rem))] animate-pop overflow-hidden rounded-xl border border-line bg-surface shadow-overlay">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-[13px] font-semibold text-ink">Notificações</p>
            {notifications.unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void notifications.markAllRead()}
                className="text-[12px] font-medium text-brand hover:underline"
              >
                Marcar todas como lidas
              </button>
            )}
          </header>

          <div className="scroll-area max-h-96 overflow-y-auto">
            {notifications.items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-ink-subtle">
                Nenhuma notificação por aqui.
              </p>
            ) : (
              <ul>
                {notifications.items.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => {
                        void notifications.markRead(notification.id);
                        if (notification.conversationId && onOpenConversation) {
                          onOpenConversation(notification.conversationId);
                        }
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-0',
                        notification.readAt ? 'hover:bg-surface-2' : 'bg-brand-soft/40 hover:bg-brand-soft/70',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          notification.readAt ? 'bg-transparent' : 'bg-accent',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-ink">
                            {notification.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-subtle">
                            {formatRelative(notification.createdAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-ink-muted">
                          {notification.body}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
