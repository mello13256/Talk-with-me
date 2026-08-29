import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Attachment } from '@/lib/types';
import { formatBytes } from '@/lib/format';
import { IconButton } from '@/components/ui/Button';
import { ChevronLeftIcon, DownloadIcon, XIcon } from '@/components/ui/icons';

interface ImageLightboxProps {
  attachments: Attachment[];
  startId: string;
  onClose: () => void;
}

/** Full-screen image viewer with keyboard navigation. */
export function ImageLightbox({ attachments, startId, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      attachments.findIndex((attachment) => attachment.id === startId),
    ),
  );

  const move = useCallback(
    (delta: number) => {
      setIndex((current) => {
        const next = current + delta;
        if (next < 0) return attachments.length - 1;
        if (next >= attachments.length) return 0;
        return next;
      });
    },
    [attachments.length],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowLeft') move(-1);
    };
    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [move, onClose]);

  const current = attachments[index];
  if (!current) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex animate-fade-in flex-col bg-black/92"
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{current.name}</p>
          <p className="text-[12px] text-white/60">
            {formatBytes(current.size)}
            {attachments.length > 1 && ` · ${index + 1} de ${attachments.length}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <a
            href={current.url}
            download={current.name}
            aria-label="Baixar imagem"
            title="Baixar imagem"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <DownloadIcon size={18} />
          </a>
          <IconButton
            label="Fechar"
            onClick={onClose}
            className="text-white/80 hover:bg-white/10 hover:text-white"
          >
            <XIcon size={19} />
          </IconButton>
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 items-center justify-center p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <img
          src={current.url}
          alt={current.name}
          className="max-h-full max-w-full animate-pop rounded-lg object-contain"
        />
      </div>

      {attachments.length > 1 && (
        <div className="flex items-center justify-center gap-4 pb-6 text-white">
          <IconButton
            label="Anterior"
            onClick={() => move(-1)}
            className="text-white/80 hover:bg-white/10 hover:text-white"
          >
            <ChevronLeftIcon size={20} />
          </IconButton>
          <IconButton
            label="Próxima"
            onClick={() => move(1)}
            className="rotate-180 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <ChevronLeftIcon size={20} />
          </IconButton>
        </div>
      )}
    </div>,
    document.body,
  );
}
