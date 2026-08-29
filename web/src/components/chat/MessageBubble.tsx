import { memo } from 'react';
import { cn } from '@/lib/cn';
import { formatBytes, formatTime } from '@/lib/format';
import { linkify } from '@/lib/linkify';
import type { Attachment, Message } from '@/lib/types';
import { Menu } from '@/components/ui/Menu';
import { IconButton } from '@/components/ui/Button';
import {
  AlertIcon,
  CheckAllIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  MoreIcon,
  ReplyIcon,
  RotateIcon,
  TrashIcon,
} from '@/components/ui/icons';

interface MessageBubbleProps {
  message: Message;
  own: boolean;
  /** First of a run from the same sender — only that one shows the tail. */
  groupStart: boolean;
  groupEnd: boolean;
  canDelete: boolean;
  highlighted?: boolean;
  onReply: (message: Message) => void;
  onDelete: (message: Message) => void;
  onRetry: (message: Message) => void;
  onCopy: (message: Message) => void;
  onOpenImage: (attachment: Attachment, all: Attachment[]) => void;
}

function DeliveryStatus({ message }: { message: Message }) {
  if (message.failed) {
    return <AlertIcon size={13} className="text-danger" aria-label="Falha no envio" />;
  }
  if (message.pending) {
    return <ClockIcon size={13} className="opacity-70" aria-label="Enviando" />;
  }
  if (message.readAt) {
    return <CheckAllIcon size={14} className="text-sky-300" aria-label="Visualizada" />;
  }
  return <CheckIcon size={14} className="opacity-70" aria-label="Enviada" />;
}

function ImageGrid({
  attachments,
  onOpen,
}: {
  attachments: Attachment[];
  onOpen: (attachment: Attachment) => void;
}) {
  return (
    <div
      className={cn(
        'grid gap-1 overflow-hidden rounded-xl',
        attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
      )}
    >
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onOpen(attachment)}
          className="group relative block overflow-hidden bg-black/5 transition-opacity hover:opacity-95 dark:bg-white/5"
          style={
            attachments.length === 1 && attachment.width && attachment.height
              ? { aspectRatio: `${attachment.width} / ${attachment.height}`, maxHeight: '20rem' }
              : { aspectRatio: '1 / 1' }
          }
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

function FileChip({ attachment, own }: { attachment: Attachment; own: boolean }) {
  return (
    <a
      href={attachment.url}
      download={attachment.name}
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
        own
          ? 'border-white/20 bg-white/10 hover:bg-white/15'
          : 'border-line bg-surface-2 hover:bg-surface-3',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          own ? 'bg-white/15' : 'bg-surface',
        )}
      >
        <FileIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{attachment.name}</span>
        <span className={cn('block text-[11px]', own ? 'opacity-75' : 'text-ink-subtle')}>
          {formatBytes(attachment.size)}
        </span>
      </span>
      <DownloadIcon size={16} className="shrink-0 opacity-70" />
    </a>
  );
}

function MessageBubbleImpl({
  message,
  own,
  groupStart,
  groupEnd,
  canDelete,
  highlighted,
  onReply,
  onDelete,
  onRetry,
  onCopy,
  onOpenImage,
}: MessageBubbleProps) {
  if (message.kind === 'system') {
    return (
      <div className="flex justify-center py-1">
        <p className="max-w-md rounded-full bg-surface-2 px-4 py-1.5 text-center text-[12px] leading-relaxed text-ink-muted">
          {message.body}
        </p>
      </div>
    );
  }

  const deleted = Boolean(message.deletedAt);
  const images = message.attachments.filter((attachment) => attachment.isImage);
  const files = message.attachments.filter((attachment) => !attachment.isImage);
  const hasText = message.body.trim().length > 0;

  const actions = [
    ...(deleted
      ? []
      : [
          { label: 'Responder', icon: <ReplyIcon size={15} />, onSelect: () => onReply(message) },
          ...(hasText
            ? [{ label: 'Copiar texto', icon: <CopyIcon size={15} />, onSelect: () => onCopy(message) }]
            : []),
          ...(canDelete
            ? [
                {
                  label: 'Excluir',
                  icon: <TrashIcon size={15} />,
                  tone: 'danger' as const,
                  onSelect: () => onDelete(message),
                },
              ]
            : []),
        ]),
  ];

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        'group flex items-end gap-1.5 px-3 sm:px-4',
        own ? 'flex-row-reverse' : 'flex-row',
        groupEnd ? 'mb-2.5' : 'mb-0.5',
        highlighted && 'animate-fade-in rounded-xl bg-brand-soft/60 py-1 transition-colors',
      )}
    >
      <div
        className={cn(
          'relative min-w-0 max-w-[85%] sm:max-w-[min(68%,34rem)]',
          'animate-rise rounded-2xl px-3 py-2 text-[15px] shadow-card sm:text-[14.5px]',
          own
            ? 'bg-bubble-out text-bubble-out-ink'
            : 'border border-line bg-bubble-in text-ink',
          // Squared-off corner marks the start of a run from one sender.
          own
            ? groupStart
              ? 'rounded-tr-md'
              : 'rounded-tr-2xl'
            : groupStart
              ? 'rounded-tl-md'
              : 'rounded-tl-2xl',
          message.pending && 'opacity-75',
          message.failed && 'ring-1 ring-danger/50',
        )}
      >
        {message.replyTo && !deleted && (
          <button
            type="button"
            onClick={() => {
              document
                .getElementById(`message-${message.replyTo!.id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            className={cn(
              'mb-1.5 block w-full rounded-lg border-l-2 px-2.5 py-1.5 text-left text-[12.5px]',
              own
                ? 'border-white/50 bg-white/10 text-white/85'
                : 'border-brand bg-brand-soft/70 text-ink-muted',
            )}
          >
            <span className="block font-semibold">
              {message.replyTo.senderName ?? 'Mensagem'}
            </span>
            <span className="line-clamp-2 block opacity-90">
              {message.replyTo.isDeleted
                ? 'Mensagem excluída'
                : message.replyTo.body || (message.replyTo.hasAttachment ? 'Anexo' : '')}
            </span>
          </button>
        )}

        {deleted ? (
          <p className="flex items-center gap-1.5 py-0.5 text-[13.5px] italic opacity-70">
            <TrashIcon size={14} />
            Esta mensagem foi excluída
          </p>
        ) : (
          <>
            {images.length > 0 && (
              <div className={cn(hasText || files.length > 0 ? 'mb-1.5' : '-mx-1 -my-0.5')}>
                <ImageGrid
                  attachments={images}
                  onOpen={(attachment) => onOpenImage(attachment, images)}
                />
              </div>
            )}
            {files.length > 0 && (
              <div className={cn('space-y-1.5', hasText && 'mb-1.5')}>
                {files.map((attachment) => (
                  <FileChip key={attachment.id} attachment={attachment} own={own} />
                ))}
              </div>
            )}
            {hasText && <p className="prose-message">{linkify(message.body)}</p>}
          </>
        )}

        <div
          className={cn(
            'mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-4',
            own ? 'text-white/70' : 'text-ink-subtle',
          )}
        >
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {own && !deleted && <DeliveryStatus message={message} />}
        </div>

        {message.failed && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold underline underline-offset-2"
          >
            <RotateIcon size={13} />
            Tentar novamente
          </button>
        )}
      </div>

      {actions.length > 0 && (
        <Menu
          align={own ? 'right' : 'left'}
          items={actions}
          className="mb-1"
          trigger={({ toggle, open, id }) => (
            <IconButton
              id={id}
              label="Ações da mensagem"
              size="sm"
              onClick={toggle}
              className={cn(
                'transition-opacity',
                // Always reachable by keyboard and on touch; visible on hover elsewhere.
                open ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
              )}
            >
              <MoreIcon size={16} />
            </IconButton>
          )}
        />
      )}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);
