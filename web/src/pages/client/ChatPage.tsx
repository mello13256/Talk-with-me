import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSocketEvent } from '@/context/SocketContext';
import { useToast } from '@/context/ToastContext';
import { useConversation } from '@/hooks/useConversation';
import type { NotificationsState } from '@/hooks/useNotifications';
import type { Agent, Attachment, Conversation, Message } from '@/lib/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { InstallBanner } from '@/components/InstallApp';
import { ConnectionBadge } from '@/components/layout/ConnectionBadge';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ConversationSearch } from '@/components/chat/ConversationSearch';
import { Composer } from '@/components/chat/Composer';
import { ImageLightbox } from '@/components/chat/ImageLightbox';
import { MessageList } from '@/components/chat/MessageList';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { AlertIcon } from '@/components/ui/icons';

export function ChatPage({ notifications }: { notifications: NotificationsState }) {
  const { user } = useAuth();
  const toast = useToast();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: Attachment[]; startId: string } | null>(null);

  const boot = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      const data = await api.get<{ conversation: Conversation; agent: Agent | null }>(
        '/conversations/me',
      );
      setConversation(data.conversation);
      setAgent(data.agent);
    } catch {
      setBootError('Não foi possível abrir sua conversa. Verifique sua conexão e tente de novo.');
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const thread = useConversation(conversation?.id ?? null, conversation?.status ?? 'open');

  // The operator's availability is what the client actually cares about.
  useSocketEvent<{ userId: string; isOnline: boolean; lastSeenAt: string | null }>(
    'presence',
    (payload) => {
      setAgent((current) =>
        current && current.id === payload.userId
          ? { ...current, isOnline: payload.isOnline, lastSeenAt: payload.lastSeenAt }
          : current,
      );
    },
  );

  const jumpToMessage = useCallback((messageId: string) => {
    setSearching(false);
    setHighlightedId(messageId);
    window.setTimeout(() => {
      document
        .getElementById(`message-${messageId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    window.setTimeout(() => setHighlightedId(null), 2400);
  }, []);

  const copyMessage = useCallback(
    async (message: Message) => {
      try {
        await navigator.clipboard.writeText(message.body);
        toast.success('Mensagem copiada.');
      } catch {
        toast.error('Não foi possível copiar.');
      }
    },
    [toast],
  );

  if (booting) {
    return (
      <div className="flex app-height items-center justify-center bg-canvas">
        <Spinner size={26} className="text-brand" />
      </div>
    );
  }

  if (bootError || !conversation) {
    return (
      <div className="flex app-height flex-col bg-canvas">
        <AppHeader notifications={notifications} />
        <EmptyState
          className="flex-1"
          icon={<AlertIcon size={22} />}
          title="Algo deu errado"
          description={bootError ?? 'Conversa indisponível.'}
          action={
            <Button variant="secondary" onClick={() => void boot()}>
              Tentar novamente
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex app-height flex-col bg-canvas">
      <AppHeader notifications={notifications} />
      <InstallBanner />
      <ConnectionBadge />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden border-line bg-surface sm:my-4 sm:rounded-2xl sm:border sm:shadow-card">
        <ChatHeader
          name={agent?.name ?? 'Atendimento'}
          seed={agent?.id ?? 'agent'}
          avatarUrl={agent?.avatarUrl ?? null}
          isOnline={agent?.isOnline ?? false}
          lastSeenAt={agent?.lastSeenAt ?? null}
          resolved={thread.status === 'resolved'}
          onToggleSearch={() => setSearching((value) => !value)}
          searchActive={searching}
        />

        {searching && (
          <ConversationSearch
            conversationId={conversation.id}
            onSelect={jumpToMessage}
            onClose={() => setSearching(false)}
          />
        )}

        {thread.status === 'resolved' && (
          <p className="border-b border-line bg-success-soft px-4 py-2 text-center text-[12.5px] text-success">
            Este atendimento foi marcado como concluído. Escreva abaixo para reabrir a conversa.
          </p>
        )}

        {thread.error && (
          <div className="flex items-center justify-between gap-3 border-b border-line bg-danger-soft px-4 py-2.5">
            <p className="text-[12.5px] text-danger">{thread.error}</p>
            <Button size="sm" variant="secondary" onClick={() => void thread.reload()}>
              Recarregar
            </Button>
          </div>
        )}

        <MessageList
          messages={thread.messages}
          currentUserId={user!.id}
          isAdmin={false}
          loading={thread.loading}
          loadingOlder={thread.loadingOlder}
          hasMore={thread.hasMore}
          typingName={thread.typingName}
          highlightedId={highlightedId}
          emptyTitle="Comece a conversa"
          emptyDescription="Escreva sua mensagem abaixo. Respondo por aqui assim que possível."
          onLoadOlder={() => void thread.loadOlder()}
          onReply={setReplyTo}
          onDelete={setPendingDeletion}
          onRetry={(message) => void thread.retry(message)}
          onCopy={(message) => void copyMessage(message)}
          onOpenImage={(attachment, all) => setLightbox({ items: all, startId: attachment.id })}
          onReachedBottom={thread.markRead}
        />

        <Composer
          conversationId={conversation.id}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={thread.send}
          onTyping={thread.notifyTyping}
          placeholder="Escreva sua mensagem…"
        />
      </div>

      {lightbox && (
        <ImageLightbox
          attachments={lightbox.items}
          startId={lightbox.startId}
          onClose={() => setLightbox(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDeletion)}
        title="Excluir mensagem?"
        description="A mensagem será removida da conversa para você e para o atendimento. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        loading={deleting}
        onCancel={() => setPendingDeletion(null)}
        onConfirm={async () => {
          if (!pendingDeletion) return;
          setDeleting(true);
          try {
            await thread.remove(pendingDeletion.id);
            setPendingDeletion(null);
          } catch {
            toast.error('Não foi possível excluir a mensagem.');
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
