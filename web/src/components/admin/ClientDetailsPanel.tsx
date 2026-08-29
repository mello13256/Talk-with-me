import { formatDateTime, formatLastSeen } from '@/lib/format';
import type { AdminClient } from '@/lib/types';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import {
  BanIcon,
  BuildingIcon,
  CheckCircleIcon,
  ClockIcon,
  MailIcon,
  PhoneIcon,
  RotateIcon,
  TrashIcon,
  XIcon,
} from '@/components/ui/icons';

interface ClientDetailsPanelProps {
  client: AdminClient;
  onClose: () => void;
  onEdit: () => void;
  onToggleBlock: () => void;
  onDelete: () => void;
  onToggleResolved: () => void;
  busy?: boolean;
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 text-ink-subtle">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11.5px] uppercase tracking-wide text-ink-subtle">{label}</p>
        <p className="break-words text-[13.5px] text-ink">{value}</p>
      </div>
    </div>
  );
}

export function ClientDetailsPanel({
  client,
  onClose,
  onEdit,
  onToggleBlock,
  onDelete,
  onToggleResolved,
  busy = false,
}: ClientDetailsPanelProps) {
  const resolved = client.conversationStatus === 'resolved';

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-line bg-surface xl:w-80">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold text-ink">Dados do cliente</h2>
        <IconButton label="Fechar painel" size="sm" onClick={onClose}>
          <XIcon size={17} />
        </IconButton>
      </header>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="flex flex-col items-center text-center">
          <Avatar
            name={client.name}
            seed={client.id}
            src={client.avatarUrl}
            size="xl"
            online={client.isOnline}
          />
          <p className="mt-3 text-[16px] font-semibold text-ink">{client.name}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {client.isOnline ? 'online agora' : formatLastSeen(client.lastSeenAt)}
          </p>

          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {client.isBlocked && <Badge tone="danger">Bloqueado</Badge>}
            {resolved && <Badge tone="success">Resolvida</Badge>}
            {!resolved && !client.isBlocked && <Badge tone="brand">Aberta</Badge>}
          </div>
        </div>

        <div className="mt-6 divide-y divide-line border-y border-line">
          <DetailRow icon={<MailIcon size={16} />} label="E-mail" value={client.email} />
          {client.phone && (
            <DetailRow icon={<PhoneIcon size={16} />} label="Telefone" value={client.phone} />
          )}
          {client.company && (
            <DetailRow icon={<BuildingIcon size={16} />} label="Empresa" value={client.company} />
          )}
          <DetailRow
            icon={<ClockIcon size={16} />}
            label="Cliente desde"
            value={formatDateTime(client.createdAt)}
          />
          <DetailRow
            icon={<ClockIcon size={16} />}
            label="Último contato"
            value={client.lastMessageAt ? formatDateTime(client.lastMessageAt) : 'Nenhum ainda'}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold tabular-nums text-ink">{client.messageCount}</p>
            <p className="text-[11.5px] text-ink-muted">mensagens</p>
          </div>
          <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold tabular-nums text-ink">{client.unreadCount}</p>
            <p className="text-[11.5px] text-ink-muted">não lidas</p>
          </div>
        </div>

        {client.isBlocked && client.blockedReason && (
          <p className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
            <span className="font-semibold">Motivo do bloqueio: </span>
            {client.blockedReason}
          </p>
        )}

        <div className="mt-5">
          <p className="mb-1.5 text-[11.5px] uppercase tracking-wide text-ink-subtle">
            Anotações internas
          </p>
          <p className="whitespace-pre-wrap rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-muted">
            {client.notes?.trim() || 'Nenhuma anotação. Use "Editar" para adicionar.'}
          </p>
          <p className="mt-1.5 text-[11.5px] text-ink-subtle">Nunca visível para o cliente.</p>
        </div>
      </div>

      <footer className="shrink-0 space-y-2 border-t border-line p-3">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit} disabled={busy}>
            Editar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={resolved ? <RotateIcon size={14} /> : <CheckCircleIcon size={14} />}
            onClick={onToggleResolved}
            disabled={busy || !client.conversationId}
          >
            {resolved ? 'Reabrir' : 'Resolver'}
          </Button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          icon={client.isBlocked ? <CheckCircleIcon size={14} /> : <BanIcon size={14} />}
          onClick={onToggleBlock}
          disabled={busy}
        >
          {client.isBlocked ? 'Desbloquear cliente' : 'Bloquear cliente'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          icon={<TrashIcon size={14} />}
          onClick={onDelete}
          disabled={busy}
          className="text-danger hover:bg-danger-soft hover:text-danger"
        >
          Excluir cliente
        </Button>
      </footer>
    </aside>
  );
}
