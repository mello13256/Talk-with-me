import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { prepareFile } from '@/lib/image';
import type { Attachment, Message } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { IconButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { FileIcon, PaperclipIcon, ReplyIcon, SendIcon, XIcon } from '@/components/ui/icons';

interface PendingUpload {
  key: string;
  name: string;
  size: number;
  previewUrl: string | null;
  progress: number;
  attachment: Attachment | null;
  error: string | null;
}

interface ComposerProps {
  conversationId: string;
  disabled?: boolean;
  disabledReason?: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSend: (input: { body: string; attachments: Attachment[]; replyTo: Message | null }) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  placeholder?: string;
}

const MAX_FILES = 10;

export function Composer({
  conversationId,
  disabled = false,
  disabledReason,
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
  placeholder = 'Escreva sua mensagem…',
}: ComposerProps) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const typingStopTimer = useRef<number | null>(null);

  // Auto-grow up to ~6 lines, then scroll inside the textarea.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [text]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  useEffect(
    () => () => {
      if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
      for (const upload of uploads) {
        if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
      }
    },
    // Runs on unmount only; uploads is intentionally read from the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled || files.length === 0) return;

      const room = MAX_FILES - uploads.length;
      if (room <= 0) {
        toast.error(`Máximo de ${MAX_FILES} arquivos por mensagem.`);
        return;
      }

      for (const file of files.slice(0, room)) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // Large photos are resized in the browser before they leave the device.
        const prepared = await prepareFile(file);

        setUploads((current) => [
          ...current,
          {
            key,
            name: prepared.file.name,
            size: prepared.file.size,
            previewUrl: prepared.previewUrl,
            progress: 0,
            attachment: null,
            error: null,
          },
        ]);

        const form = new FormData();
        form.append('file', prepared.file);
        form.append('conversationId', conversationId);
        if (prepared.width) form.append('width', String(prepared.width));
        if (prepared.height) form.append('height', String(prepared.height));

        try {
          const response = await api.upload<{ attachment: Attachment }>('/attachments', form, {
            onProgress: (progress) =>
              setUploads((current) =>
                current.map((item) => (item.key === key ? { ...item, progress } : item)),
              ),
          });
          setUploads((current) =>
            current.map((item) =>
              item.key === key
                ? { ...item, attachment: response.attachment, progress: 100 }
                : item,
            ),
          );
        } catch (caught) {
          const message =
            caught instanceof ApiError ? caught.message : 'Não foi possível enviar o arquivo.';
          setUploads((current) =>
            current.map((item) => (item.key === key ? { ...item, error: message } : item)),
          );
          toast.error(message);
        }
      }
    },
    [conversationId, disabled, uploads.length, toast],
  );

  const removeUpload = useCallback((key: string) => {
    setUploads((current) => {
      const target = current.find((item) => item.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }, []);

  const ready = uploads.filter((upload) => upload.attachment).map((upload) => upload.attachment!);
  const uploading = uploads.some((upload) => !upload.attachment && !upload.error);
  const canSend = !disabled && !sending && !uploading && (text.trim().length > 0 || ready.length > 0);

  const submit = useCallback(async () => {
    if (!canSend) return;
    const body = text;
    const attachments = ready;
    const reply = replyTo;

    setSending(true);
    try {
      await onSend({ body, attachments, replyTo: reply });
      setText('');
      for (const upload of uploads) {
        if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
      }
      setUploads([]);
      onCancelReply();
      textareaRef.current?.focus();
    } catch (caught) {
      // The failed bubble stays in the thread with a retry action, so the text
      // is not lost even though the composer is cleared.
      toast.error(caught instanceof ApiError ? caught.message : 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  }, [canSend, text, ready, replyTo, uploads, onSend, onCancelReply, toast]);

  const handleChange = (value: string) => {
    setText(value);
    onTyping(value.length > 0);
    if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
    typingStopTimer.current = window.setTimeout(() => onTyping(false), 2500);
  };

  if (disabled) {
    return (
      <div className="border-t border-line bg-surface px-4 py-4 text-center">
        <p className="text-[13px] text-ink-muted">{disabledReason}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative border-t border-line bg-surface transition-colors',
        dragging && 'bg-brand-soft',
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (event.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand">
          <p className="text-sm font-semibold text-brand">Solte os arquivos para anexar</p>
        </div>
      )}

      {replyTo && (
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-2">
          <ReplyIcon size={16} className="shrink-0 text-brand" />
          <div className="min-w-0 flex-1 border-l-2 border-brand pl-2.5">
            <p className="text-[12px] font-semibold text-brand">Respondendo</p>
            <p className="truncate text-[13px] text-ink-muted">
              {replyTo.body || (replyTo.attachments.length > 0 ? 'Anexo' : 'Mensagem')}
            </p>
          </div>
          <IconButton label="Cancelar resposta" size="sm" onClick={onCancelReply}>
            <XIcon size={16} />
          </IconButton>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="scroll-area flex gap-2 overflow-x-auto border-b border-line px-4 py-3">
          {uploads.map((upload) => (
            <div
              key={upload.key}
              className={cn(
                'group relative flex h-20 w-20 shrink-0 flex-col items-center justify-center overflow-hidden',
                'rounded-xl border bg-surface-2',
                upload.error ? 'border-danger' : 'border-line',
              )}
              title={upload.name}
            >
              {upload.previewUrl ? (
                <img src={upload.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 px-1 text-center">
                  <FileIcon size={20} className="text-ink-subtle" />
                  <span className="w-full truncate text-[10px] text-ink-subtle">{upload.name}</span>
                  <span className="text-[10px] text-ink-subtle">{formatBytes(upload.size)}</span>
                </div>
              )}

              {!upload.attachment && !upload.error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-white">
                  <Spinner size={16} />
                  <span className="text-[10px] font-semibold tabular-nums">{upload.progress}%</span>
                </div>
              )}

              {upload.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-danger/85 p-1 text-center text-[10px] font-medium text-white">
                  Falhou
                </div>
              )}

              <button
                type="button"
                onClick={() => removeUpload(upload.key)}
                aria-label={`Remover ${upload.name}`}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              >
                <XIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-3 sm:px-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <IconButton
          label="Anexar arquivo"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploads.length >= MAX_FILES}
        >
          <PaperclipIcon size={19} />
        </IconButton>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={() => onTyping(false)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter inserts a line break.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length > 0) {
              event.preventDefault();
              void addFiles(files);
            }
          }}
          rows={1}
          placeholder={placeholder}
          aria-label="Mensagem"
          className={cn(
            'scroll-area max-h-42 min-h-10 flex-1 resize-none rounded-xl border border-line bg-canvas',
            'px-3.5 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-subtle',
            'transition-[border-color,box-shadow] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20',
            'sm:text-sm',
          )}
        />

        <IconButton
          label="Enviar mensagem"
          onClick={() => void submit()}
          disabled={!canSend}
          className={cn(
            'h-10 w-10 shrink-0 rounded-xl transition-all',
            canSend
              ? 'bg-brand text-brand-ink hover:bg-brand-hover'
              : 'bg-surface-2 text-ink-subtle',
          )}
        >
          {sending ? <Spinner size={17} /> : <SendIcon size={18} />}
        </IconButton>
      </div>
    </div>
  );
}
