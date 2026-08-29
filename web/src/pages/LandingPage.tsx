import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import {
  ArrowRightIcon,
  CheckIcon,
  DevicesIcon,
  HistoryIcon,
  LockIcon,
  PaperclipIcon,
  ShieldIcon,
  ZapIcon,
} from '@/components/ui/icons';

const FEATURES = [
  {
    icon: <LockIcon size={20} />,
    title: 'Comunicação privada',
    description:
      'Cada cliente tem um canal próprio, isolado dos demais. Não existe grupo, fórum nem conversa entre clientes.',
  },
  {
    icon: <ZapIcon size={20} />,
    title: 'Atendimento rápido',
    description:
      'Mensagens em tempo real, confirmação de leitura e aviso de quando estou online para responder.',
  },
  {
    icon: <HistoryIcon size={20} />,
    title: 'Histórico completo',
    description:
      'Todo o histórico fica salvo e pesquisável. Nada se perde entre e-mails, aplicativos e telefonemas.',
  },
  {
    icon: <PaperclipIcon size={20} />,
    title: 'Envio de arquivos',
    description:
      'Documentos, comprovantes e imagens direto na conversa, com pré-visualização antes de enviar.',
  },
  {
    icon: <ShieldIcon size={20} />,
    title: 'Segurança levada a sério',
    description:
      'Senhas protegidas, sessões revogáveis e permissões verificadas no servidor — não apenas na tela.',
  },
  {
    icon: <DevicesIcon size={20} />,
    title: 'Celular e computador',
    description:
      'A mesma conversa no telefone, no tablet e no computador, com notificações onde você estiver.',
  },
];

const STEPS = [
  { title: 'Crie sua conta', description: 'Leva menos de um minuto: nome, e-mail e senha.' },
  { title: 'Escreva sua mensagem', description: 'Conte o que precisa e anexe o que for necessário.' },
  { title: 'Receba a resposta', description: 'Eu respondo no mesmo canal e você é notificado.' },
];

export function LandingPage() {
  const { user } = useAuth();
  const dashboard = user?.role === 'admin' ? '/admin' : '/chat';

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Logo />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <Link to={dashboard}>
                <Button size="sm" iconRight={<ArrowRightIcon size={15} />}>
                  Abrir minha conversa
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/entrar">
                  <Button variant="ghost" size="sm">
                    Entrar
                  </Button>
                </Link>
                <Link to="/criar-conta">
                  <Button size="sm">Criar conta</Button>
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:pt-24">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[52rem] -translate-x-1/2 rounded-full opacity-[0.09] blur-3xl"
            style={{ background: 'radial-gradient(circle, var(--brand), transparent 65%)' }}
          />
          <div className="relative mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Canal exclusivo de atendimento
            </span>

            <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-[3.4rem]">
              Um canal privado para
              <br className="hidden sm:block" /> falar diretamente comigo.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-ink-muted">
              Sem grupos, sem fila e sem mensagens perdidas. Você escreve, eu respondo — e todo o
              histórico fica organizado em um só lugar, no celular ou no computador.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to={user ? dashboard : '/criar-conta'} className="w-full sm:w-auto">
                <Button size="lg" fullWidth iconRight={<ArrowRightIcon size={17} />}>
                  {user ? 'Abrir minha conversa' : 'Criar conta'}
                </Button>
              </Link>
              {!user && (
                <Link to="/entrar" className="w-full sm:w-auto">
                  <Button size="lg" variant="secondary" fullWidth>
                    Entrar
                  </Button>
                </Link>
              )}
            </div>

            <p className="mt-4 text-[13px] text-ink-subtle">
              Grátis para meus clientes · Sem instalar aplicativo
            </p>
          </div>

          {/* Product preview */}
          <div className="relative mx-auto mt-16 max-w-3xl">
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay">
              <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-ink-subtle/30" />
                <span className="h-2.5 w-2.5 rounded-full bg-ink-subtle/30" />
                <span className="h-2.5 w-2.5 rounded-full bg-ink-subtle/30" />
                <span className="ml-2 text-[12px] font-medium text-ink-subtle">
                  Conversa privada
                </span>
              </div>
              <div className="space-y-3 p-5 sm:p-7">
                <div className="flex justify-start">
                  <p className="max-w-[78%] rounded-2xl rounded-tl-md border border-line bg-bubble-in px-3.5 py-2.5 text-[14px] text-ink shadow-card">
                    Boa tarde! Consegue verificar o andamento do meu pedido?
                  </p>
                </div>
                <div className="flex justify-end">
                  <p className="max-w-[78%] rounded-2xl rounded-tr-md bg-bubble-out px-3.5 py-2.5 text-[14px] text-bubble-out-ink shadow-card">
                    Claro. Já verifiquei aqui e ele sai hoje — vou te mandar o comprovante em
                    seguida.
                  </p>
                </div>
                <div className="flex justify-end">
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                    <CheckIcon size={13} /> visualizada
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-line bg-surface px-5 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                Tudo o que um bom atendimento precisa
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
                Simples de usar para você, organizado para mim. Nada de mensagens espalhadas por
                cinco aplicativos diferentes.
              </p>
            </div>

            <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title}>
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    {feature.icon}
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-ink">{feature.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="px-5 py-20">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-center text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Como funciona
            </h2>
            <ol className="mt-12 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex flex-col items-center text-center sm:items-start sm:text-left">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-[13px] font-semibold text-brand">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
                    {step.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Security */}
        <section className="border-y border-line bg-surface px-5 py-16">
          <div className="mx-auto flex max-w-4xl flex-col items-start gap-6 sm:flex-row sm:items-center">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <ShieldIcon size={24} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-ink">
                Sua conversa é sua — e de mais ninguém
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
                Cada permissão é verificada no servidor a cada requisição. As senhas nunca são
                armazenadas em texto puro, os arquivos só são entregues a quem participa da conversa
                e sua sessão pode ser encerrada em todos os dispositivos a qualquer momento.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-5 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Pronto para começar?
            </h2>
            <p className="mt-3 text-[15px] text-ink-muted">
              Crie sua conta e envie a primeira mensagem agora mesmo.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to={user ? dashboard : '/criar-conta'} className="w-full sm:w-auto">
                <Button size="lg" fullWidth iconRight={<ArrowRightIcon size={17} />}>
                  {user ? 'Abrir minha conversa' : 'Criar conta'}
                </Button>
              </Link>
              {!user && (
                <Link to="/entrar" className="w-full sm:w-auto">
                  <Button size="lg" variant="secondary" fullWidth>
                    Já tenho conta
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <Logo compact />
          <p className="text-[12.5px] text-ink-subtle">
            © {new Date().getFullYear()} Talk with me · Canal privado de atendimento
          </p>
        </div>
      </footer>
    </div>
  );
}
