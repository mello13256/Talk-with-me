import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDayLabel } from '@/lib/format';
import type { Attachment, Message } from '@/lib/types';
import { MessageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { ArrowDownIcon, ChatIcon } from '@/components/ui/icons';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';

interface MessageListProps {
  messages: Message[];
  currentUserId: string;
  isAdmin: boolean;
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  typingName: string | null;
  highlightedId?: string | null;
  emptyTitle: string;
  emptyDescription: string;
  onLoadOlder: () => void;
  onReply: (message: Message) => void;
  onDelete: (message: Message) => void;
  onRetry: (message: Message) => void;
  onCopy: (message: Message) => void;
  onOpenImage: (attachment: Attachment, all: Attachment[]) => void;
  onReachedBottom: () => void;
}

const NEAR_BOTTOM_PX = 140;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

interface Row {
  message: Message;
  dayLabel: string | null;
  groupStart: boolean;
  groupEnd: boolean;
}

/** Adds day separators and groups consecutive messages from the same sender. */
function buildRows(messages: Message[]): Row[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];

    const day = new Date(message.createdAt).toDateString();
    const previousDay = previous ? new Date(previous.createdAt).toDateString() : null;

    const sameSenderAs = (other: Message | undefined) =>
      Boolean(other) &&
      other!.senderId === message.senderId &&
      other!.kind !== 'system' &&
      message.kind !== 'system' &&
      Math.abs(new Date(other!.createdAt).getTime() - new Date(message.createdAt).getTime()) <
        GROUP_WINDOW_MS;

    return {
      message,
      dayLabel: day !== previousDay ? formatDayLabel(message.createdAt) : null,
      groupStart: day !== previousDay || !sameSenderAs(previous),
      groupEnd: !next || new Date(next.createdAt).toDateString() !== day || !sameSenderAs(next),
    };
  });
}

export function MessageList({
  messages,
  currentUserId,
  isAdmin,
  loading,
  loadingOlder,
  hasMore,
  typingName,
  highlightedId,
  emptyTitle,
  emptyDescription,
  onLoadOlder,
  onReply,
  onDelete,
  onRetry,
  onCopy,
  onOpenImage,
  onReachedBottom,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  const previousCount = useRef(0);
  const previousFirstId = useRef<string | null>(null);
  const heightBeforeLoad = useRef(0);

  // Held in a ref so a caller that re-creates the callback each render cannot
  // turn "mark as read" into a render loop.
  const reachedBottomRef = useRef(onReachedBottom);
  reachedBottomRef.current = onReachedBottom;

  const rows = useMemo(() => buildRows(messages), [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    setUnseenCount(0);
    setPinnedToBottom(true);
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distanceFromBottom < NEAR_BOTTOM_PX;
    setPinnedToBottom(atBottom);
    if (atBottom) {
      setUnseenCount(0);
      reachedBottomRef.current();
    }

    // Infinite scroll upwards: remember the height so the viewport can be
    // restored after the older page is prepended.
    if (element.scrollTop < 240 && hasMore && !loadingOlder) {
      heightBeforeLoad.current = element.scrollHeight;
      onLoadOlder();
    }
  }, [hasMore, loadingOlder, onLoadOlder]);

  // Keep the reading position stable when older messages are prepended.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const firstId = messages[0]?.id ?? null;

    const prepended =
      previousFirstId.current !== null &&
      firstId !== previousFirstId.current &&
      messages.length > previousCount.current;

    if (prepended && heightBeforeLoad.current > 0) {
      element.scrollTop += element.scrollHeight - heightBeforeLoad.current;
      heightBeforeLoad.current = 0;
    }

    previousFirstId.current = firstId;
  }, [messages]);

  // New message at the bottom: follow it, or offer a jump button.
  useLayoutEffect(() => {
    const added = messages.length - previousCount.current;
    previousCount.current = messages.length;
    if (added <= 0) return;

    const latest = messages.at(-1);
    const isOwn = latest?.senderId === currentUserId;

    if (pinnedToBottom || isOwn) {
      scrollToBottom(previousCount.current === added ? 'auto' : 'smooth');
    } else {
      setUnseenCount((count) => count + added);
    }
  }, [messages, pinnedToBottom, currentUserId, scrollToBottom]);

  // First paint of a thread lands at the newest message, without animation.
  useEffect(() => {
    if (!loading && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [loading, messages.length]);

  useEffect(() => {
    if (pinnedToBottom && document.visibilityState === 'visible') reachedBottomRef.current();
  }, [pinnedToBottom, messages.length]);

  if (loading) return <MessageSkeleton />;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scroll-area h-full overflow-y-auto overscroll-contain py-3"
      >
        {hasMore && (
          <div className="flex justify-center py-3">
            {loadingOlder ? (
              <Spinner className="text-ink-subtle" />
            ) : (
              <button
                type="button"
                onClick={onLoadOlder}
                className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:bg-surface-3"
              >
                Carregar mensagens anteriores
              </button>
            )}
          </div>
        )}

        {messages.length === 0 && !hasMore && (
          <EmptyState
            icon={<ChatIcon size={22} />}
            title={emptyTitle}
            description={emptyDescription}
            className="py-20"
          />
        )}

        {rows.map(({ message, dayLabel, groupStart, groupEnd }) => (
          <div key={message.id}>
            {dayLabel && (
              <div className="sticky top-1 z-10 flex justify-center py-2">
                <span className="rounded-full border border-line bg-surface/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted backdrop-blur">
                  {dayLabel}
                </span>
              </div>
            )}
            <MessageBubble
              message={message}
              own={message.senderId === currentUserId}
              groupStart={groupStart}
              groupEnd={groupEnd}
              canDelete={isAdmin || message.senderId === currentUserId}
              highlighted={highlightedId === message.id}
              onReply={onReply}
              onDelete={onDelete}
              onRetry={onRetry}
              onCopy={onCopy}
              onOpenImage={onOpenImage}
            />
          </div>
        ))}

        {typingName && <TypingIndicator name={typingName} />}
        <div ref={bottomRef} className="h-1" />
      </div>

      {(!pinnedToBottom || unseenCount > 0) && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className={cn(
            'absolute bottom-4 right-4 z-20 flex animate-pop items-center gap-2 rounded-full',
            'border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold text-ink shadow-overlay',
            'transition-transform hover:-translate-y-0.5',
          )}
        >
          {unseenCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">
              {unseenCount > 99 ? '99+' : unseenCount}
            </span>
          )}
          {unseenCount > 0 ? 'novas mensagens' : <ArrowDownIcon size={16} />}
        </button>
      )}
    </div>
  );
}
