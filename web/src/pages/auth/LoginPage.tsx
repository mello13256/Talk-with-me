import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { MailIcon } from '@/components/ui/icons';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? (user.role === 'admin' ? '/admin' : '/chat')} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const signedIn = await login(email, password);
      navigate(signedIn.role === 'admin' ? '/admin' : '/chat', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.details) {
          setFieldErrors(
            Object.fromEntries(caught.details.map((detail) => [detail.field, detail.message])),
          );
        }
      } else {
        setError('Não foi possível entrar. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse seu canal privado de atendimento."
      error={error}
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/criar-conta" className="font-semibold text-brand hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="E-mail"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          icon={<MailIcon size={17} />}
          value={email}
          error={fieldErrors.email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@exemplo.com"
        />

        <div>
          <Input
            label="Senha"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
          />
          <div className="mt-2 text-right">
            <Link
              to="/recuperar-senha"
              className="text-[13px] font-medium text-brand hover:underline"
            >
              Esqueci minha senha
            </Link>
          </div>
        </div>

        <Button type="submit" fullWidth size="lg" loading={submitting}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
