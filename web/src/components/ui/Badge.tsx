import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-muted',
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  accent: 'bg-accent text-white',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Unread counter. Renders nothing at zero so callers do not need a guard. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5',
        'text-[11px] font-bold tabular-nums text-white',
        className,
      )}
      aria-label={`${count} não lidas`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
