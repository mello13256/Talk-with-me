import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatLastSeen } from '@/lib/format';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { ChevronLeftIcon, SearchIcon } from '@/components/ui/icons';

interface ChatHeaderProps {
  name: string;
  seed: string;
  avatarUrl: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  resolved?: boolean;
  blocked?: boolean;
  onBack?: () => void;
  onToggleSearch?: () => void;
  searchActive?: boolean;
  actions?: ReactNode;
  subtitleOverride?: string;
}

export function ChatHeader({
  name,
  seed,
  avatarUrl,
  isOnline,
  lastSeenAt,
  resolved,
  blocked,
  onBack,
  onToggleSearch,
  searchActive,
  actions,
  subtitleOverride,
}: ChatHeaderProps) {
  return (
    <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
      {onBack && (
        <IconButton label="Voltar" onClick={onBack} className="lg:hidden">
          <ChevronLeftIcon size={20} />
        </IconButton>
      )}

      <Avatar name={name} seed={seed} src={avatarUrl} size="md" online={isOnline} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[15px] font-semibold text-ink">{name}</h1>
          {blocked && <Badge tone="danger">Bloqueado</Badge>}
          {resolved && !blocked && <Badge tone="success">Resolvida</Badge>}
        </div>
        <p
          className={cn(
            'truncate text-[12.5px]',
            isOnline && !subtitleOverride ? 'text-success' : 'text-ink-subtle',
          )}
        >
          {subtitleOverride ?? (isOnline ? 'online agora' : formatLastSeen(lastSeenAt))}
        </p>
      </div>

      <div className="flex items-center gap-1">
        {onToggleSearch && (
          <IconButton
            label={searchActive ? 'Fechar busca' : 'Buscar na conversa'}
            onClick={onToggleSearch}
            className={cn(searchActive && 'bg-surface-2 text-ink')}
          >
            <SearchIcon size={18} />
          </IconButton>
        )}
        {actions}
      </div>
    </header>
  );
}
