import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { SocketProvider, useSocketEvent } from '@/context/SocketContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider, useToast } from '@/context/ToastContext';
import { useNotifications } from '@/hooks/useNotifications';
import { registerServiceWorker } from '@/lib/push';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { ChatPage } from '@/pages/client/ChatPage';
import { ProfilePage } from '@/pages/client/ProfilePage';
import { AdminPage } from '@/pages/admin/AdminPage';
import { AdminSettingsPage } from '@/pages/admin/AdminSettingsPage';

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <Spinner size={26} className="text-brand" />
    </div>
  );
}

function RequireAuth({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/entrar" state={{ from: location.pathname }} replace />;
  // Server-side authorization is the real gate; this only avoids a dead screen.
  if (adminOnly && user.role !== 'admin') return <Navigate to="/chat" replace />;
  if (!adminOnly && user.role === 'admin' && location.pathname === '/chat') {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <p className="text-5xl font-semibold text-ink-subtle">404</p>
      <p className="text-[15px] text-ink-muted">Não encontramos esta página.</p>
      <Link to="/">
        <Button variant="secondary">Voltar ao início</Button>
      </Link>
    </div>
  );
}

/** Signs the user out immediately when the server revokes their session. */
function SessionWatcher() {
  const { refresh } = useAuth();
  const toast = useToast();

  useSocketEvent<{ reason: string }>('session:revoked', (payload) => {
    const message =
      payload.reason === 'blocked'
        ? 'Seu acesso foi bloqueado pelo administrador.'
        : payload.reason === 'account_deleted'
          ? 'Sua conta foi removida.'
          : 'Sua sessão foi encerrada. Entre novamente.';
    toast.error(message);
    void refresh();
  });

  return null;
}

function AppRoutes() {
  const { user } = useAuth();
  const notifications = useNotifications(Boolean(user));

  useEffect(() => {
    // Registered up front so an already-granted push permission keeps working
    // after a reload, without prompting anybody.
    void registerServiceWorker();
  }, []);

  return (
    <>
      <SessionWatcher />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/criar-conta" element={<RegisterPage />} />
        <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />

        <Route
          path="/chat"
          element={
            <RequireAuth>
              <ChatPage notifications={notifications} />
            </RequireAuth>
          }
        />
        <Route
          path="/perfil"
          element={
            <RequireAuth>
              <ProfilePage notifications={notifications} />
            </RequireAuth>
          }
        />

        <Route
          path="/admin"
          element={
            <RequireAuth adminOnly>
              <AdminPage notifications={notifications} />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/conversations/:conversationId"
          element={
            <RequireAuth adminOnly>
              <AdminPage notifications={notifications} />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/configuracoes"
          element={
            <RequireAuth adminOnly>
              <AdminSettingsPage notifications={notifications} />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <SocketProvider>
              <AppRoutes />
            </SocketProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
