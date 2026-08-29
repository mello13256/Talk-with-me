import { useState } from 'react';
import { cn } from '@/lib/cn';
import { avatarHue, initials } from '@/lib/format';

interface AvatarProps {
  name: string;
  src?: string | null;
  /** Stable colour seed; defaults to the name. */
  seed?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  className?: string;
}

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-[13px]',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
} as const;

const DOT_SIZES = {
  xs: 'h-2 w-2',
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
  xl: 'h-5 w-5',
} as const;

export function Avatar({ name, src, seed, size = 'md', online, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const hue = avatarHue(seed ?? name);
  const showImage = Boolean(src) && !failed;

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center overflow-hidden rounded-full font-semibold',
          'ring-1 ring-black/5 dark:ring-white/10',
          SIZES[size],
        )}
        style={
          showImage
            ? undefined
            : {
                // Deterministic pastel derived from the id, so the same person
                // always gets the same colour across every screen.
                backgroundColor: `oklch(0.9 0.055 ${hue})`,
                color: `oklch(0.42 0.11 ${hue})`,
              }
        }
      >
        {showImage ? (
          <img
            src={src ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          initials(name)
        )}
      </span>
      {online !== undefined && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface',
            DOT_SIZES[size],
            online ? 'bg-success' : 'bg-ink-subtle/60',
          )}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  );
}
