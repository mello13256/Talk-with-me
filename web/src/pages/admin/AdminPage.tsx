import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useAdminClients } from '@/hooks/useAdminClients';
import { useConversation } from '@/hooks/useConversation';
import type { NotificationsState } from '@/hooks/useNotifications';
import type { AdminClient, Attachment, Message } from '@/lib/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { ConnectionBadge } from '@/components/layout/ConnectionBadge';
import { ClientList } from '@/components/admin/ClientList';
import { ClientDetailsPanel } from '@/components/admin/ClientDetailsPanel';
import { ClientFormModal } from '@/components/admin/ClientFormModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { Composer } from '@/components/chat/Composer';
import { ConversationSearch } from '@/components/chat/ConversationSearch';
import { ImageLightbox } from '@/components/chat/ImageLightbox';
import { MessageList } from '@/components/chat/MessageList';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Field';
import {
  BanIcon,
  CheckCircleIcon,
  ChatIcon,
  RotateIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
  ZapIcon,
} from '@/components/ui/icons';
import { Menu } from '@/components/ui/Menu';
import { MoreIcon } from '@/components/ui/icons';

type PendingAction = 'block' | 'unblock' | 'delete' | null;

function StatTile({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone?: 'accent' | 'brand';
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <span
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg',
          tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-brand-soft text-brand',
        )}
      >
        {icon}
      </span>
      <p className="mt-2.5 text-2xl font-semibold tabular-nums leading-none text-ink">{value}</p>
      <p className="mt-1 text-[12.5px] text-ink-muted">{label}</p>
    </div>
  );
}

export function AdminPage({ notifications }: { notifications: NotificationsState }) {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const clientsState = useAdminClients(true);
  const [fetchedClient, setFetchedClient] = useState<AdminClient | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<AdminClient | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [blockReason, setBlockReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<Message | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: Attachment[]; startId: string } | null>(null);

  const activeClient = useMemo<AdminClient | null>(() => {
    if (!conversationId) return null;
    return (
      clientsState.clients.find((client) => client.conversationId === conversationId) ??
      (fetchedClient?.conversationId === conversationId ? fetchedClient : null)
    );
  }, [conversationId, clientsState.clients, fetchedClient]);

  // Deep links can point at a conversation that the current filter hides.
  useEffect(() => {
    if (!conversationId) {
      setFetchedClient(null);
      return;
    }
    if (clientsState.clients.some((client) => client.conversationId === conversationId)) return;
    if (fetchedClient?.conversationId === conversationId) return;

    let cancelled = false;
    void (async () => {
      try {
        const details = await api.get<{ client: { id: string } | null }>(
          `/conversations/${conversationId}`,
        );
        if (!details.client || cancelled) return;
        const full = await api.get<{ client: AdminClient }>(`/admin/clients/${details.client.id}`);
        if (!cancelled) setFetchedClient(full.client);
      } catch {
        if (!cancelled) navigate('/admin', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, clientsState.clients, fetchedClient, navigate]);

  const thread = useConversation(
    conversationId ?? null,
    activeClient?.conversationStatus ?? 'open',
  );

  const openConversation = useCallback(
    (client: AdminClient) => {
      if (!client.conversationId) return;
      setReplyTo(null);
      setSearching(false);
      navigate(`/admin/conversations/${client.conversationId}`);
    },
    [navigate],
  );

  // Depends only on stable callbacks, never on the whole list state object.
  const { markRead } = thread;
  const { clearUnread } = clientsState;
  const markReadAndClear = useCallback(() => {
    markRead();
    if (conversationId) clearUnread(conversationId);
  }, [markRead, clearUnread, conversationId]);

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

  const toggleResolved = useCallback(async () => {
    if (!activeClient?.conversationId) return;
    const resolving = activeClient.conversationStatus !== 'resolved';
    try {
      await api.post(
        `/admin/conversations/${activeClient.conversationId}/${resolving ? 'resolve' : 'reopen'}`,
      );
      clientsState.patchClient(activeClient.id, {
        conversationStatus: resolving ? 'resolved' : 'open',
      });
      toast.success(resolving ? 'Conversa marcada como resolvida.' : 'Conversa reaberta.');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Não foi possível atualizar.');
    }
  }, [activeClient, clientsState, toast]);

  const runPendingAction = useCallback(async () => {
    if (!activeClient || !pendingAction) return;
    setActionBusy(true);
    try {
      if (pendingAction === 'block') {
        await api.post(`/admin/clients/${activeClient.id}/block`, { reason: blockReason.trim() });
        clientsState.patchClient(activeClient.id, {
          isBlocked: true,
          blockedReason: blockReason.trim() || null,
          isOnline: false,
        });
        toast.success('Cliente bloqueado e desconectado.');
      } else if (pendingAction === 'unblock') {
        await api.post(`/admin/clients/${activeClient.id}/unblock`);
        clientsState.patchClient(activeClient.id, { isBlocked: false, blockedReason: null });
        toast.success('Cliente desbloqueado.');
      } else {
        await api.delete(`/admin/clients/${activeClient.id}`);
        clientsState.removeClient(activeClient.id);
        toast.success('Cliente excluído.');
        navigate('/admin', { replace: true });
        setDetailsOpen(false);
      }
      setPendingAction(null);
      setBlockReason('');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Não foi possível concluir.');
    } finally {
      setActionBusy(false);
    }
  }, [activeClient, pendingAction, blockReason, clientsState, toast, navigate]);

  const stats = clientsState.stats;

  return (
    <div className="flex app-height flex-col bg-canvas">
      <AppHeader
        notifications={notifications}
        onOpenConversation={(id) => navigate(`/admin/conversations/${id}`)}
      />
      <ConnectionBadge />

      <div className="flex min-h-0 flex-1">
        {/* Conversation list — full width on mobile until a thread is opened. */}
        <div
          className={cn(
            'w-full shrink-0 border-r border-line lg:w-80 xl:w-96',
            conversationId ? 'hidden lg:block' : 'block',
          )}
        >
          <ClientList
            state={clientsState}
            selectedConversationId={conversationId ?? null}
            onSelect={openConversation}
            onCreate={() => {
              setEditingClient(null);
              setFormOpen(true);
            }}
          />
        </div>

        {/* Main area */}
        <main className={cn('min-w-0 flex-1', conversationId ? 'flex' : 'hidden lg:flex')}>
          {!conversationId || !activeClient ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
              {stats && (
                <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile
                    icon={<ZapIcon size={17} />}
                    value={stats.unansweredConversations}
                    label="a responder"
                    tone="accent"
                  />
                  <StatTile icon={<UsersIcon size={17} />} value={stats.clients} label="clientes" />
                  <StatTile icon={<UserIcon size={17} />} value={stats.online} label="online agora" />
                  <StatTile
                    icon={<ChatIcon size={17} />}
                    value={stats.messagesLast24h}
                    label="msgs em 24 h"
                  />
                </div>
              )}
              <div className="max-w-sm text-center">
                <p className="text-[15px] font-semibold text-ink">Selecione uma conversa</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
                  Escolha um cliente na lista ao lado para ver o histórico completo e responder.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col bg-surface">
              <ChatHeader
                name={activeClient.name}
                seed={activeClient.id}
                avatarUrl={activeClient.avatarUrl}
                isOnline={activeClient.isOnline}
                lastSeenAt={activeClient.lastSeenAt}
                resolved={activeClient.conversationStatus === 'resolved'}
                blocked={activeClient.isBlocked}
                onBack={() => navigate('/admin')}
                onToggleSearch={() => setSearching((value) => !value)}
                searchActive={searching}
                actions={
                  <>
                    <IconButton
                      label="Dados do cliente"
                      onClick={() => setDetailsOpen((value) => !value)}
                      className={cn('hidden sm:inline-flex', detailsOpen && 'bg-surface-2 text-ink')}
                    >
                      <UserIcon size={18} />
                    </IconButton>
                    <Menu
                      items={[
                        {
                          label:
                            activeClient.conversationStatus === 'resolved'
                              ? 'Reabrir conversa'
                              : 'Marcar como resolvida',
                          icon:
                            activeClient.conversationStatus === 'resolved' ? (
                              <RotateIcon size={15} />
                            ) : (
                              <CheckCircleIcon size={15} />
                            ),
                          onSelect: () => void toggleResolved(),
                        },
                        {
                          label: 'Dados do cliente',
                          icon: <UserIcon size={15} />,
                          onSelect: () => setDetailsOpen(true),
                        },
                        {
                          label: activeClient.isBlocked ? 'Desbloquear cliente' : 'Bloquear cliente',
                          icon: activeClient.isBlocked ? <CheckCircleIcon size={15} /> : <BanIcon size={15} />,
                          onSelect: () =>
                            setPendingAction(activeClient.isBlocked ? 'unblock' : 'block'),
                        },
                        {
                          label: 'Excluir cliente',
                          icon: <TrashIcon size={15} />,
                          tone: 'danger' as const,
                          onSelect: () => setPendingAction('delete'),
                        },
                      ]}
                      trigger={({ toggle, id }) => (
                        <IconButton id={id} label="Mais ações" onClick={toggle}>
                          <MoreIcon size={18} />
                        </IconButton>
                      )}
                    />
                  </>
                }
              />

              {searching && (
                <ConversationSearch
                  conversationId={conversationId}
                  onSelect={(messageId) => {
                    setSearching(false);
                    setHighlightedId(messageId);
                    window.setTimeout(() => {
                      document
                        .getElementById(`message-${messageId}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 60);
                    window.setTimeout(() => setHighlightedId(null), 2400);
                  }}
                  onClose={() => setSearching(false)}
                />
              )}

              {activeClient.isBlocked && (
                <p className="border-b border-line bg-danger-soft px-4 py-2 text-center text-[12.5px] text-danger">
                  Este cliente está bloqueado e não consegue acessar a conta.
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
                isAdmin
                loading={thread.loading}
                loadingOlder={thread.loadingOlder}
                hasMore={thread.hasMore}
                typingName={thread.typingName}
                highlightedId={highlightedId}
                emptyTitle="Nenhuma mensagem ainda"
                emptyDescription="Envie a primeira mensagem para iniciar o atendimento."
                onLoadOlder={() => void thread.loadOlder()}
                onReply={setReplyTo}
                onDelete={setPendingDeletion}
                onRetry={(message) => void thread.retry(message)}
                onCopy={(message) => void copyMessage(message)}
                onOpenImage={(attachment, all) =>
                  setLightbox({ items: all, startId: attachment.id })
                }
                onReachedBottom={markReadAndClear}
              />

              <Composer
                conversationId={conversationId}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                onSend={thread.send}
                onTyping={thread.notifyTyping}
                placeholder={`Responder para ${activeClient.name.split(' ')[0]}…`}
              />
            </div>
          )}
        </main>

        {/* Client details */}
        {detailsOpen && activeClient && (
          <div className="fixed inset-0 z-40 bg-canvas xl:static xl:z-auto xl:block">
            <ClientDetailsPanel
              client={activeClient}
              busy={actionBusy}
              onClose={() => setDetailsOpen(false)}
              onEdit={() => {
                setEditingClient(activeClient);
                setFormOpen(true);
              }}
              onToggleResolved={() => void toggleResolved()}
              onToggleBlock={() => setPendingAction(activeClient.isBlocked ? 'unblock' : 'block')}
              onDelete={() => setPendingAction('delete')}
            />
          </div>
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          attachments={lightbox.items}
          startId={lightbox.startId}
          onClose={() => setLightbox(null)}
        />
      )}

      <ClientFormModal
        open={formOpen}
        client={editingClient}
        onClose={() => {
          setFormOpen(false);
          setEditingClient(null);
        }}
        onSaved={() => void clientsState.refresh()}
      />

      {/* Blocking needs a reason, so it gets its own dialog. */}
      <Modal
        open={pendingAction === 'block'}
        onClose={() => setPendingAction(null)}
        title="Bloquear cliente"
        description="O acesso é revogado na hora e todas as sessões abertas são encerradas."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingAction(null)} disabled={actionBusy}>
              Cancelar
            </Button>
            <Button variant="danger" loading={actionBusy} onClick={() => void runPendingAction()}>
              Bloquear
            </Button>
          </>
        }
      >
        <Input
          label="Motivo (opcional)"
          value={blockReason}
          onChange={(event) => setBlockReason(event.target.value)}
          placeholder="Ex.: uso indevido do canal"
          hint="O motivo é mostrado ao cliente na tela de login."
          data-autofocus
        />
      </Modal>

      <ConfirmDialog
        open={pendingAction === 'unblock'}
        title="Desbloquear cliente?"
        description="O cliente volta a acessar a conta e a conversa normalmente."
        confirmLabel="Desbloquear"
        tone="primary"
        loading={actionBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void runPendingAction()}
      />

      <ConfirmDialog
        open={pendingAction === 'delete'}
        title={`Excluir ${activeClient?.name ?? 'cliente'}?`}
        description="A conta, a conversa, todas as mensagens e todos os arquivos serão apagados definitivamente. Esta ação não pode ser desfeita."
        confirmLabel="Excluir definitivamente"
        loading={actionBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void runPendingAction()}
      />

      <ConfirmDialog
        open={Boolean(pendingDeletion)}
        title="Excluir mensagem?"
        description="A mensagem some da conversa para os dois lados. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        loading={deletingMessage}
        onCancel={() => setPendingDeletion(null)}
        onConfirm={async () => {
          if (!pendingDeletion) return;
          setDeletingMessage(true);
          try {
            await thread.remove(pendingDeletion.id);
            setPendingDeletion(null);
          } catch {
            toast.error('Não foi possível excluir a mensagem.');
          } finally {
            setDeletingMessage(false);
          }
        }}
      />
    </div>
  );
}
