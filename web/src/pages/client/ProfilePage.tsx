import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import {
  disablePushNotifications,
  enablePushNotifications,
  notificationPermission,
  pushSupported,
} from '@/lib/push';
import { useAuth } from '@/context/AuthContext';
import { useTheme, type ThemePreference } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import type { NotificationsState } from '@/hooks/useNotifications';
import type { User } from '@/lib/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import {
  BellIcon,
  ChevronLeftIcon,
  DevicesIcon,
  LockIcon,
  TrashIcon,
  UserIcon,
} from '@/components/ui/icons';

interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

function Section({
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

/** Turns a raw user-agent into something a person can recognise. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Dispositivo desconhecido';
  const browser =
    /edg/i.test(userAgent) ? 'Edge'
    : /chrome|crios/i.test(userAgent) ? 'Chrome'
    : /firefox|fxios/i.test(userAgent) ? 'Firefox'
    : /safari/i.test(userAgent) ? 'Safari'
    : 'Navegador';
  const platform =
    /iphone|ipad/i.test(userAgent) ? 'iOS'
    : /android/i.test(userAgent) ? 'Android'
    : /mac os/i.test(userAgent) ? 'macOS'
    : /windows/i.test(userAgent) ? 'Windows'
    : /linux/i.test(userAgent) ? 'Linux'
    : 'Outro';
  return `${browser} · ${platform}`;
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
];

export function ProfilePage({ notifications }: { notifications: NotificationsState }) {
  const { user, setUser } = useAuth();
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [company, setCompany] = useState(user?.company ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const [pushOn, setPushOn] = useState(() => notificationPermission() === 'granted');
  const [pushBusy, setPushBusy] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.get<{ sessions: SessionInfo[] }>('/auth/sessions');
      setSessions(data.sessions);
    } catch {
      /* the section simply stays empty */
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  if (!user) return null;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileError(null);
    setSavingProfile(true);
    try {
      const data = await api.patch<{ user: User }>('/me/profile', {
        name,
        phone: phone.trim(),
        company: company.trim(),
      });
      setUser(data.user);
      toast.success('Perfil atualizado.');
    } catch (caught) {
      setProfileError(caught instanceof ApiError ? caught.message : 'Não foi possível salvar.');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Senha alterada. Os outros dispositivos foram desconectados.');
      void loadSessions();
    } catch (caught) {
      setPasswordError(
        caught instanceof ApiError ? caught.message : 'Não foi possível alterar a senha.',
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api.upload<{ user: User }>('/me/avatar', form);
      setUser(data.user);
      toast.success('Foto atualizada.');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Não foi possível enviar a foto.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePushNotifications();
        setPushOn(false);
        toast.notify('Notificações do navegador desativadas.');
      } else {
        const ok = await enablePushNotifications();
        setPushOn(ok);
        toast.notify(
          ok
            ? 'Notificações do navegador ativadas.'
            : 'Não foi possível ativar. Verifique a permissão no navegador.',
          ok ? 'success' : 'error',
        );
      }
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <AppHeader notifications={notifications} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-8">
        <div className="mb-6 flex items-center gap-2">
          <IconButton label="Voltar" onClick={() => navigate(-1)}>
            <ChevronLeftIcon size={20} />
          </IconButton>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Meu perfil</h1>
        </div>

        <div className="space-y-5">
          <Section
            icon={<UserIcon size={18} />}
            title="Informações pessoais"
            description="Como você aparece no atendimento."
          >
            <div className="mb-6 flex items-center gap-4">
              <Avatar name={user.name} seed={user.id} src={user.avatarUrl} size="xl" />
              <div className="space-y-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadAvatar(file);
                    event.target.value = '';
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={uploadingAvatar}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    Trocar foto
                  </Button>
                  {user.avatarUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const data = await api.delete<{ user: User }>('/me/avatar');
                        setUser(data.user);
                      }}
                    >
                      Remover
                    </Button>
                  )}
                </div>
                <p className="text-[12px] text-ink-subtle">PNG, JPG ou WebP · até 25 MB</p>
              </div>
            </div>

            <form onSubmit={saveProfile} className="space-y-4">
              <Input
                label="Nome"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
              <Input
                label="E-mail"
                value={user.email}
                disabled
                hint="Para alterar o e-mail, fale com o atendimento."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Telefone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="(11) 90000-0000"
                />
                <Input
                  label="Empresa"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  placeholder="Opcional"
                />
              </div>
              {profileError && <p className="text-[13px] text-danger">{profileError}</p>}
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-[12.5px] text-ink-subtle">
                  Conta criada em {formatDateTime(user.createdAt)}
                </p>
                <Button type="submit" loading={savingProfile}>
                  Salvar
                </Button>
              </div>
            </form>
          </Section>

          <Section
            icon={<BellIcon size={18} />}
            title="Notificações e aparência"
            description="Como e onde você quer ser avisado."
          >
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[14px] font-medium text-ink">Notificações do navegador</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">
                    {pushSupported()
                      ? 'Receba um aviso mesmo com a aba fechada.'
                      : 'Não disponível neste navegador.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={pushOn ? 'secondary' : 'primary'}
                  loading={pushBusy}
                  disabled={!pushSupported()}
                  onClick={() => void togglePush()}
                >
                  {pushOn ? 'Desativar' : 'Ativar'}
                </Button>
              </div>

              <div>
                <p className="mb-2 text-[14px] font-medium text-ink">Tema</p>
                <div className="inline-flex rounded-xl border border-line bg-canvas p-1">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPreference(option.value)}
                      className={cn(
                        'rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                        preference === option.value
                          ? 'bg-surface text-ink shadow-card'
                          : 'text-ink-muted hover:text-ink',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section
            icon={<LockIcon size={18} />}
            title="Alterar senha"
            description="Ao alterar, os outros dispositivos são desconectados."
          >
            <form onSubmit={changePassword} className="space-y-4">
              <Input
                label="Senha atual"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
              <Input
                label="Nova senha"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                hint="Mínimo de 10 caracteres, com três tipos de caractere."
                required
              />
              {passwordError && <p className="text-[13px] text-danger">{passwordError}</p>}
              <div className="flex justify-end">
                <Button
                  type="submit"
                  loading={savingPassword}
                  disabled={!currentPassword || newPassword.length < 10}
                >
                  Alterar senha
                </Button>
              </div>
            </form>
          </Section>

          <Section
            icon={<DevicesIcon size={18} />}
            title="Sessões ativas"
            description="Dispositivos com acesso à sua conta agora."
          >
            <ul className="divide-y divide-line">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-ink">
                      {describeDevice(session.userAgent)}
                      {session.current && (
                        <span className="ml-2 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
                          este dispositivo
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-subtle">
                      Último acesso em {formatDateTime(session.lastUsedAt)}
                      {session.ip && ` · ${session.ip}`}
                    </p>
                  </div>
                </li>
              ))}
              {sessions.length === 0 && (
                <li className="py-3 text-[13px] text-ink-subtle">Nenhuma sessão listada.</li>
              )}
            </ul>

            {sessions.length > 1 && (
              <div className="mt-4 flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<TrashIcon size={15} />}
                  onClick={() => setConfirmingRevoke(true)}
                >
                  Encerrar outras sessões
                </Button>
              </div>
            )}
          </Section>
        </div>
      </main>

      <ConfirmDialog
        open={confirmingRevoke}
        title="Encerrar outras sessões?"
        description="Todos os outros dispositivos precisarão entrar novamente. Este continuará conectado."
        confirmLabel="Encerrar"
        loading={revoking}
        onCancel={() => setConfirmingRevoke(false)}
        onConfirm={async () => {
          setRevoking(true);
          try {
            await api.post('/auth/sessions/revoke-others');
            await loadSessions();
            toast.success('Outras sessões encerradas.');
            setConfirmingRevoke(false);
          } catch {
            toast.error('Não foi possível encerrar as sessões.');
          } finally {
            setRevoking(false);
          }
        }}
      />
    </div>
  );
}
