import { cn } from '@/lib/cn';

/**
 * Wordmark: two overlapping rounded speech shapes — one channel, two people.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path
        d="M9 12.5A2.5 2.5 0 0 1 11.5 10h6A2.5 2.5 0 0 1 20 12.5v3a2.5 2.5 0 0 1-2.5 2.5H13l-4 3v-8.5Z"
        fill="var(--brand-ink)"
        fillOpacity="0.95"
      />
      <path
        d="M23 15.5a2.5 2.5 0 0 0-2.5-2.5H20v2.5a4.5 4.5 0 0 1-4.5 4.5H14v.5A2.5 2.5 0 0 0 16.5 23h3l3.5 2.5v-10Z"
        fill="var(--brand-ink)"
        fillOpacity="0.6"
      />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={compact ? 26 : 30} />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-ink">Talk with me</span>
      )}
    </span>
  );
}
