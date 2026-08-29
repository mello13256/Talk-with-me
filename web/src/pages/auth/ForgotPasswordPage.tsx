import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { CheckCircleIcon, MailIcon } from '@/components/ui/icons';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível enviar o e-mail.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout
        title="Verifique seu e-mail"
        subtitle="Se existir uma conta com esse endereço, o link de recuperação já está a caminho."
        footer={
          <Link to="/entrar" className="font-semibold text-brand hover:underline">
            Voltar para o login
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success-soft text-success">
            <CheckCircleIcon size={24} />
          </span>
          <p className="text-[14px] leading-relaxed text-ink-muted">
            O link expira em 1 hora e só pode ser usado uma vez. Não encontrou? Confira também a
            caixa de spam.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Informe seu e-mail e enviaremos um link para criar uma nova senha."
      error={error}
      footer={
        <>
          Lembrou a senha?{' '}
          <Link to="/entrar" className="font-semibold text-brand hover:underline">
            Entrar
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
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@exemplo.com"
        />
        <Button type="submit" fullWidth size="lg" loading={submitting}>
          Enviar link de recuperação
        </Button>
      </form>
    </AuthLayout>
  );
}
