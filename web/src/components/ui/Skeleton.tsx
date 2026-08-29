import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-shimmer rounded-md bg-surface-3', className)} />;
}

/** Placeholder rows for the conversation list while the first page loads. */
export function ConversationSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1 p-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl p-3">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Alternating bubble placeholders that mimic a real thread. */
export function MessageSkeleton() {
  const widths = ['w-40', 'w-64', 'w-32', 'w-56', 'w-48'];
  return (
    <div className="space-y-4 p-4" aria-hidden="true">
      {widths.map((width, index) => (
        <div key={index} className={cn('flex', index % 2 === 0 ? 'justify-start' : 'justify-end')}>
          <Skeleton className={cn('h-11 rounded-2xl', width)} />
        </div>
      ))}
    </div>
  );
}
