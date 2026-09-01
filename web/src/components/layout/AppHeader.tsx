import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import type { NotificationsState } from '@/hooks/useNotifications';
import { Avatar } from '@/components/ui/Avatar';
import { Menu } from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/Modal';
import {
  ChevronDownIcon,
  InstallIcon,
  LogOutIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from '@/components/ui/icons';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { InstallHelpDialog } from '@/components/InstallApp';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';

interface AppHeaderProps {
  notifications: NotificationsState;
  onOpenConversation?: (conversationId: string) => void;
}

export function AppHeader({ notifications, onOpenConversation }: AppHeaderProps) {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const install = useInstallPrompt();
  const [showIosInstall, setShowIosInstall] = useState(false);

  if (!user) return null;

  // Só entra no menu quando há de fato o que fazer: com o app já instalado, ou
  // num navegador que não oferece o caminho, o item não aparece.
  const installItem =
    install.kind === 'installed' || install.kind === 'unavailable'
      ? []
      : [
          {
            label: 'Instalar aplicativo',
            icon: <InstallIcon size={15} />,
            onSelect: () =>
              install.kind === 'ready' ? void install.install() : setShowIosInstall(true),
          },
        ];

  const home = isAdmin ? '/admin' : '/chat';

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 sm:px-4">
        <Link to={home} className="rounded-lg" aria-label="Início">
          <Logo />
        </Link>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <NotificationBell notifications={notifications} onOpenConversation={onOpenConversation} />

          <Menu
            items={[
              {
                label: 'Meu perfil',
                icon: <UserIcon size={15} />,
                onSelect: () => navigate('/perfil'),
              },
              ...(isAdmin
                ? [
                    {
                      label: 'Painel de atendimento',
                      icon: <UsersIcon size={15} />,
                      onSelect: () => navigate('/admin'),
                    },
                    {
                      label: 'Configurações',
                      icon: <SettingsIcon size={15} />,
                      onSelect: () => navigate('/admin/configuracoes'),
                    },
                  ]
                : []),
              ...installItem,
              {
                label: 'Sair da conta',
                icon: <LogOutIcon size={15} />,
                tone: 'danger' as const,
                onSelect: () => setConfirmingLogout(true),
              },
            ]}
            trigger={({ toggle, id }) => (
              <button
                id={id}
                type="button"
                onClick={toggle}
                className="ml-1 flex items-center gap-1.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-surface-2"
                aria-label="Menu da conta"
              >
                <Avatar name={user.name} seed={user.id} src={user.avatarUrl} size="sm" />
                <span className="hidden max-w-32 truncate text-[13px] font-medium text-ink sm:block">
                  {user.name.split(' ')[0]}
                </span>
                <ChevronDownIcon size={14} className="text-ink-subtle" />
              </button>
            )}
          />
        </div>
      </header>

      <InstallHelpDialog
        open={showIosInstall}
        onClose={() => setShowIosInstall(false)}
        platform={install.kind === 'manual' ? install.platform : 'other'}
      />

      <ConfirmDialog
        open={confirmingLogout}
        title="Sair da conta?"
        description="Você precisará entrar novamente para acessar suas conversas neste dispositivo."
        confirmLabel="Sair"
        loading={loggingOut}
        onCancel={() => setConfirmingLogout(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          await logout();
          setLoggingOut(false);
          setConfirmingLogout(false);
          navigate('/entrar', { replace: true });
        }}
      />
    </>
  );
}
