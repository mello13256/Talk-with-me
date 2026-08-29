import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { AuthLayout } from './AuthLayout';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const checks = useMemo(
    () => [
      { label: 'Pelo menos 10 caracteres', ok: password.length >= 10 },
      {
        label: 'Três tipos de caractere',
        ok: [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length >= 3,
      },
      { label: 'As senhas coincidem', ok: password.length > 0 && password === confirmation },
    ],
    [password, confirmation],
  );
  const valid = checks.every((check) => check.ok);

  if (!token) {
    return (
      <AuthLayout
        title="Link inválido"
        subtitle="Este link de recuperação está incompleto ou expirou."
        footer={
          <Link to="/recuperar-senha" className="font-semibold text-brand hover:underline">
            Solicitar um novo link
          </Link>
        }
      >
        <p className="py-2 text-center text-[14px] text-ink-muted">
          Peça um novo link e tente novamente.
        </p>
      </AuthLayout>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      toast.success('Senha alterada. Entre com a nova senha.');
      navigate('/entrar', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível redefinir a senha.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Criar nova senha"
      subtitle="Por segurança, todas as sessões abertas serão encerradas."
      error={error}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          label="Confirmar nova senha"
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />

        {password.length > 0 && (
          <ul className="space-y-1">
            {checks.map((check) => (
              <li
                key={check.label}
                className={cn(
                  'flex items-center gap-2 text-[12.5px]',
                  check.ok ? 'text-success' : 'text-ink-subtle',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    check.ok ? 'bg-success' : 'bg-ink-subtle/50',
                  )}
                />
                {check.label}
              </li>
            ))}
          </ul>
        )}

        <Button type="submit" fullWidth size="lg" loading={submitting} disabled={!valid}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  );
}
