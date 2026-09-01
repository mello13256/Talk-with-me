import { useState } from 'react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import type { ManualPlatform } from '@/hooks/useInstallPrompt';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { InstallIcon, IosShareIcon, MoreIcon, PlusIcon, XIcon } from '@/components/ui/icons';

const DISMISSED_KEY = 'twm:install-dismissed';

/** Um passo numerado das instruções. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
        {n}
      </span>
      {/* Fluxo de texto normal, não flex: como itens de flex, a vírgula e o
          ponto final se soltariam para a linha seguinte. */}
      <span className="pt-0.5 text-[14px] leading-relaxed text-ink-muted">{children}</span>
    </li>
  );
}

/**
 * Caminho pelo menu do próprio navegador, para Android e afins. Os símbolos
 * aparecem desenhados porque descrevê-los em palavras faz o usuário caçar na
 * tela.
 */
function AndroidInstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar à tela inicial"
      description="Pelo menu do navegador, em dois toques."
      size="sm"
    >
      <ol className="space-y-3">
        <Step n={1}>
          Toque em <MoreIcon size={16} className="inline align-[-3px] text-brand" />{' '}
          <strong className="font-medium text-ink">menu</strong>, no canto do navegador.
        </Step>
        <Step n={2}>
          Escolha <strong className="font-medium text-ink">Instalar aplicativo</strong> ou{' '}
          <strong className="font-medium text-ink">Adicionar à tela inicial</strong> — o nome muda
          conforme o navegador.
        </Step>
      </ol>
      <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-subtle">
        No <strong className="font-medium">Chrome</strong> costuma aparecer sozinho. Se o seu
        navegador não mostrar a opção, abra este endereço no Chrome.
      </p>
    </Modal>
  );
}

function IosInstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Instalar no iPhone"
      description="Leva dois toques, direto pelo Safari."
      size="sm"
    >
      <ol className="space-y-3">
        <Step n={1}>
          Toque em <IosShareIcon size={17} className="inline align-[-4px] text-brand" />{' '}
          <strong className="font-medium text-ink">Compartilhar</strong>, na barra do Safari.
        </Step>
        <Step n={2}>
          Role e escolha <PlusIcon size={16} className="inline align-[-3px] text-brand" />{' '}
          <strong className="font-medium text-ink">Adicionar à Tela de Início</strong>.
        </Step>
      </ol>
      <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-subtle">
        Precisa ser pelo <strong className="font-medium">Safari</strong>. No Chrome do iPhone a
        opção não aparece — é uma limitação do iOS, não do site.
      </p>
    </Modal>
  );
}

/**
 * Escolhe as instruções conforme o aparelho. Só entra em cena quando o
 * navegador não oferece o diálogo próprio de instalação.
 */
export function InstallHelpDialog({
  open,
  onClose,
  platform,
}: {
  open: boolean;
  onClose: () => void;
  platform: ManualPlatform;
}) {
  return platform === 'ios' ? (
    <IosInstallDialog open={open} onClose={onClose} />
  ) : (
    <AndroidInstallDialog open={open} onClose={onClose} />
  );
}

/**
 * Botão de instalar. Não renderiza nada quando o app já está instalado ou
 * quando o navegador não oferece o caminho — um botão que não faz nada é pior
 * do que botão nenhum.
 */
export function InstallButton({ className }: { className?: string }) {
  const install = useInstallPrompt();
  const [showIos, setShowIos] = useState(false);

  if (install.kind === 'installed' || install.kind === 'unavailable') return null;

  return (
    <>
      <Button
        variant="secondary"
        className={className}
        icon={<InstallIcon size={16} />}
        onClick={() => (install.kind === 'ready' ? void install.install() : setShowIos(true))}
      >
        Instalar aplicativo
      </Button>
      <InstallHelpDialog
        open={showIos}
        onClose={() => setShowIos(false)}
        platform={install.kind === 'manual' ? install.platform : 'other'}
      />
    </>
  );
}

/**
 * Convite mais visível, para quem ainda não sabe que dá para instalar.
 * Dispensável, e a recusa é lembrada: um convite que reaparece a cada visita
 * deixa de ser convite.
 */
export function InstallBanner() {
  const install = useInstallPrompt();
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // Navegação privada pode negar o acesso; nesse caso o convite aparece,
      // que é melhor do que quebrar a tela.
      return false;
    }
  });

  if (dismissed || install.kind === 'installed' || install.kind === 'unavailable') return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* sem persistência: some nesta sessão e volta na próxima */
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line bg-brand-soft/60 px-3 py-2.5 sm:px-4">
        <InstallIcon size={18} className="shrink-0 text-brand" />
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
          <strong className="font-semibold">Tenha na tela inicial.</strong>{' '}
          <span className="text-ink-muted">Avisa quando eu responder.</span>
        </p>
        <Button
          size="sm"
          onClick={() => (install.kind === 'ready' ? void install.install() : setShowIos(true))}
        >
          Instalar
        </Button>
        <IconButton label="Agora não" onClick={dismiss}>
          <XIcon size={16} />
        </IconButton>
      </div>
      <InstallHelpDialog
        open={showIos}
        onClose={() => setShowIos(false)}
        platform={install.kind === 'manual' ? install.platform : 'other'}
      />
    </>
  );
}
