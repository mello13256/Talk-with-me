import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Message } from '@/lib/types';
import { Spinner } from '@/components/ui/Spinner';
import { IconButton } from '@/components/ui/Button';
import { SearchIcon, XIcon } from '@/components/ui/icons';

interface ConversationSearchProps {
  conversationId: string;
  onSelect: (messageId: string) => void;
  onClose: () => void;
}

/** Searches inside one conversation. Debounced, and cancels superseded requests. */
export function ConversationSearch({ conversationId, onSelect, onClose }: ConversationSearchProps) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get<{ items: Message[] }>(
          `/conversations/${conversationId}/messages/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        setResults(response.items);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 280);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term, conversationId]);

  return (
    <div className="border-b border-line bg-surface-2/60">
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        <SearchIcon size={17} className="shrink-0 text-ink-subtle" />
        <input
          ref={inputRef}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onClose()}
          placeholder="Buscar nesta conversa…"
          aria-label="Buscar nesta conversa"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
        />
        {loading && <Spinner size={15} className="text-ink-subtle" />}
        <IconButton label="Fechar busca" size="sm" onClick={onClose}>
          <XIcon size={16} />
        </IconButton>
      </div>

      {results !== null && (
        <div className="scroll-area max-h-64 overflow-y-auto border-t border-line">
          {results.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-ink-subtle">
              Nenhuma mensagem encontrada.
            </p>
          ) : (
            <ul>
              {results.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(message.id)}
                    className="block w-full border-b border-line px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <p className="line-clamp-2 text-[13px] text-ink">{message.body}</p>
                    <p className="mt-0.5 text-[11px] text-ink-subtle">
                      {formatDateTime(message.createdAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
