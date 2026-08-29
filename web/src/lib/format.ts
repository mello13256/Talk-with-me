const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const fullFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const formatTime = (iso: string): string => timeFormatter.format(new Date(iso));

export const formatDateTime = (iso: string): string => dateTimeFormatter.format(new Date(iso));

export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const today = startOfDay(new Date());
  const day = startOfDay(date);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);

  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(date);
  if (date.getFullYear() === today.getFullYear()) return dayFormatter.format(date);
  return fullFormatter.format(date);
}

/** Compact relative label for lists: "agora", "12:04", "ontem", "14 mar". */
export function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'agora';

  const today = startOfDay(new Date());
  const day = startOfDay(date);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);

  if (diffDays === 0) return timeFormatter.format(date);
  if (diffDays === 1) return 'ontem';
  if (diffDays < 7) return new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date);
  if (date.getFullYear() === today.getFullYear()) return dayFormatter.format(date);
  return fullFormatter.format(date);
}

export function formatLastSeen(iso: string | null): string {
  if (!iso) return 'offline';
  const diffMinutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMinutes < 1) return 'visto agora';
  if (diffMinutes < 60) return `visto há ${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `visto há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'visto ontem';
  if (days < 30) return `visto há ${days} dias`;
  return `visto em ${fullFormatter.format(new Date(iso))}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
}

/** Stable hue per user id, so an avatar keeps the same colour everywhere. */
export function avatarHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
}
