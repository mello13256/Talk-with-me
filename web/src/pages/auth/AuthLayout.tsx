import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { AlertIcon } from '@/components/ui/icons';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  error?: string | null;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, error, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center justify-between px-5 py-4">
        <Link to="/" className="rounded-lg" aria-label="Voltar para a página inicial">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-4">
        <div className="w-full max-w-sm">
          <div className="mb-7 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{subtitle}</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex animate-rise items-start gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] text-danger"
            >
              <AlertIcon size={16} className="mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">{children}</div>

          {footer && <div className="mt-6 text-center text-[13.5px] text-ink-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
