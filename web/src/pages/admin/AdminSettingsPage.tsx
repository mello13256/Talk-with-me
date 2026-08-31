import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useToast } from '@/context/ToastContext';
import type { NotificationsState } from '@/hooks/useNotifications';
import type { MessageSearchHit } from '@/lib/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import {
  AlertIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  HistoryIcon,
  MailIcon,
  SearchIcon,
  SettingsIcon,
} from '@/components/ui/icons';

interface AuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorName: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  'client.create': 'Cliente criado',
  'client.update': 'Cliente atualizado',
  'client.block': 'Cliente bloqueado',
  'client.unblock': 'Cliente desbloqueado',
  'client.delete': 'Cliente excluído',
  'conversation.resolved': 'Conversa resolvida',
  'conversation.open': 'Conversa reaberta',
  'settings.update': 'Configurações alteradas',
};

function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <header className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          {icon}
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export function AdminSettingsPage({ notifications }: { notifications: NotificationsState }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [brandName, setBrandName] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<MessageSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const [mailTesting, setMailTesting] = useState(false);
  const [mailResult, setMailResult] = useState<
    | { ok: true; driver: string; sentTo: string; config?: Record<string, string> }
    | { ok: false; error: string; hint: string; config?: Record<string, string> }
    | null
  >(null);

  useEffect(() => {
    void (async () => {
      try {
        const [settings, auditLog] = await Promise.all([
          api.get<{ brandName: string; welcomeMessage: string }>('/admin/settings'),
          api.get<{ items: AuditEntry[] }>('/admin/audit?limit=20'),
        ]);
        setBrandName(settings.brandName);
        setWelcomeMessage(settings.welcomeMessage);
        setAudit(auditLog.items);
      } catch {
        toast.error('Não foi possível carregar as configurações.');
      } finally {
        setLoaded(true);
      }
    })();
  }, [toast]);

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch('/admin/settings', { brandName, welcomeMessage });
      toast.success('Configurações salvas.');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const runSearch = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const query = term.trim();
      if (query.length < 2) return;
      setSearching(true);
      try {
        const data = await api.get<{ items: MessageSearchHit[] }>(
          `/admin/search/messages?q=${encodeURIComponent(query)}`,
        );
        setResults(data.items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [term],
  );

  const testEmail = async () => {
    setMailTesting(true);
    setMailResult(null);
    try {
      // The endpoint answers 200 either way; `ok` carries the verdict.
      const data = await api.post<
        | { ok: true; driver: string; sentTo: string; config?: Record<string, string> }
        | { ok: false; driver: string; error: string; hint: string; config?: Record<string, string> }
      >('/admin/test-email');
      setMailResult(data);
    } catch (caught) {
      setMailResult({
        ok: false,
        error: caught instanceof ApiError ? caught.message : 'Não foi possível contatar o servidor.',
        hint: 'O serviço pode estar reiniciando. Aguarde um instante e tente de novo.',
      });
    } finally {
      setMailTesting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <AppHeader notifications={notifications} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-8">
        <div className="mb-6 flex items-center gap-2">
          <IconButton label="Voltar" onClick={() => navigate('/admin')}>
            <ChevronLeftIcon size={20} />
          </IconButton>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Configurações</h1>
        </div>

        <div className="space-y-5">
          <Card
            icon={<SettingsIcon size={18} />}
            title="Identidade e boas-vindas"
            description="Aparece na recuperação de senha e na primeira mensagem de cada cliente."
          >
            {loaded ? (
              <form onSubmit={saveSettings} className="space-y-4">
                <Input
                  label="Nome do canal"
                  value={brandName}
                  onChange={(event) => setBrandName(event.target.value)}
                  maxLength={60}
                  required
                />
                <Textarea
                  label="Mensagem de boas-vindas"
                  value={welcomeMessage}
                  onChange={(event) => setWelcomeMessage(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  hint="Enviada automaticamente quando um cliente cria a conta."
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={saving}>
                    Salvar
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex justify-center py-6">
                <Spinner className="text-ink-subtle" />
              </div>
            )}
          </Card>

          <Card
            icon={<MailIcon size={18} />}
            title="Envio de e-mail"
            description="Se isto falhar, seus clientes não conseguem recuperar a senha sozinhos."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void testEmail()} loading={mailTesting}>
                Enviar e-mail de teste
              </Button>
              <span className="text-[12.5px] text-ink-subtle">
                Enviamos uma mensagem para o seu próprio endereço.
              </span>
            </div>

            {mailResult?.ok && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-success/25 bg-success-soft px-3.5 py-3 text-[13px] text-success">
                <CheckCircleIcon size={16} className="mt-px shrink-0" />
                <span>
                  Enviado para <strong>{mailResult.sentTo}</strong> pelo driver{' '}
                  <strong>{mailResult.driver}</strong>. Confira sua caixa de entrada — e o spam, na
                  primeira vez.
                </span>
              </div>
            )}

            {mailResult && !mailResult.ok && (
              <div className="mt-4 space-y-2 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] text-danger">
                <div className="flex items-start gap-2.5">
                  <AlertIcon size={16} className="mt-px shrink-0" />
                  <span>
                    <strong>O que fazer:</strong> {mailResult.hint}
                  </span>
                </div>
                <p className="pl-6 font-mono text-[11.5px] opacity-80">{mailResult.error}</p>
              </div>
            )}

            {mailResult?.config && (
              <details className="mt-3 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5">
                <summary className="cursor-pointer text-[12.5px] font-medium text-ink-muted">
                  Configuração que o servidor está usando
                </summary>
                <dl className="mt-2 space-y-1">
                  {Object.entries(mailResult.config).map(([key, value]) => (
                    <div key={key} className="flex gap-2 font-mono text-[11.5px]">
                      <dt className="shrink-0 text-ink-subtle">{key}</dt>
                      <dd className="min-w-0 break-all text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[11.5px] text-ink-subtle">
                  Senhas e chaves nunca são exibidas — apenas se estão preenchidas.
                </p>
              </details>
            )}
          </Card>

          <Card
            icon={<SearchIcon size={18} />}
            title="Buscar em todas as conversas"
            description="Procure por qualquer mensagem trocada com qualquer cliente."
          >
            <form onSubmit={runSearch} className="flex gap-2">
              <Input
                containerClassName="flex-1"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Ex.: nota fiscal, orçamento, pedido 123"
                aria-label="Termo de busca"
              />
              <Button type="submit" loading={searching} disabled={term.trim().length < 2}>
                Buscar
              </Button>
            </form>

            {results !== null && (
              <div className="mt-4">
                {results.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-ink-subtle">
                    Nenhuma mensagem encontrada.
                  </p>
                ) : (
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {results.map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/conversations/${hit.conversationId}`)}
                          className="block w-full px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-[13px] font-semibold text-ink">
                              {hit.clientName}
                            </p>
                            <span className="shrink-0 text-[11px] text-ink-subtle">
                              {formatDateTime(hit.createdAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-muted">
                            {hit.senderRole === 'admin' ? 'Você: ' : ''}
                            {hit.body}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          <Card
            icon={<HistoryIcon size={18} />}
            title="Atividade administrativa"
            description="Registro das ações privilegiadas realizadas no painel."
          >
            {audit.length === 0 ? (
              <p className="py-3 text-[13px] text-ink-subtle">Nenhuma ação registrada ainda.</p>
            ) : (
              <ul className="divide-y divide-line">
                {audit.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2.5">
                    <span className="text-[13.5px] text-ink">
                      {ACTION_LABELS[entry.action] ?? entry.action}
                      {entry.actorName && (
                        <span className="text-ink-subtle"> · {entry.actorName}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-ink-subtle">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
