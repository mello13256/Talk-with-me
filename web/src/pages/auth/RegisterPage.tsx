import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { MailIcon, UserIcon } from '@/components/ui/icons';
import { AuthLayout } from './AuthLayout';

/** Mirrors the server-side policy so the user sees the rules before submitting. */
function passwordChecks(password: string, name: string, email: string) {
  const lower = password.toLowerCase();
  const context = [name, email.split('@')[0] ?? ''].filter((value) => value.trim().length >= 4);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password));
  return [
    { label: 'Pelo menos 10 caracteres', ok: password.length >= 10 },
    { label: 'Três tipos de caractere (maiúscula, minúscula, número, símbolo)', ok: classes.length >= 3 },
    {
      label: 'Não contém seu nome ou e-mail',
      ok: password.length > 0 && !context.some((value) => lower.includes(value.toLowerCase())),
    },
  ];
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const checks = useMemo(() => passwordChecks(password, name, email), [password, name, email]);
  const passwordValid = checks.every((check) => check.ok);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/chat'} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register(name, email, password);
      navigate('/chat', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.details) {
          setFieldErrors(
            Object.fromEntries(caught.details.map((detail) => [detail.field, detail.message])),
          );
        }
      } else {
        setError('Não foi possível criar a conta. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Leva menos de um minuto e você já pode enviar sua primeira mensagem."
      error={error}
      footer={
        <>
          Já tem uma conta?{' '}
          <Link to="/entrar" className="font-semibold text-brand hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Nome completo"
          name="name"
          autoComplete="name"
          required
          autoFocus
          icon={<UserIcon size={17} />}
          value={name}
          error={fieldErrors.name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Como você quer ser chamado"
        />

        <Input
          label="E-mail"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
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
            autoComplete="new-password"
            required
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Crie uma senha forte"
          />
          {password.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {checks.map((check) => (
                <li
                  key={check.label}
                  className={cn(
                    'flex items-start gap-2 text-[12.5px] transition-colors',
                    check.ok ? 'text-success' : 'text-ink-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      check.ok ? 'bg-success' : 'bg-ink-subtle/50',
                    )}
                  />
                  {check.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button type="submit" fullWidth size="lg" loading={submitting} disabled={!passwordValid}>
          Criar conta
        </Button>

        <p className="text-center text-[12px] leading-relaxed text-ink-subtle">
          Ao criar a conta você concorda em usar este canal apenas para o atendimento.
        </p>
      </form>
    </AuthLayout>
  );
}
