import { useState } from 'react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { InstallIcon, IosShareIcon, PlusIcon, XIcon } from '@/components/ui/icons';

const DISMISSED_KEY = 'twm:install-dismissed';

/**
 * Instruções para iPhone e iPad, onde não existe API de instalação: o caminho
 * é o menu Compartilhar do próprio Safari. Os símbolos aparecem desenhados
 * porque descrevê-los em palavras faz o usuário caçar na tela.
 */
export function IosInstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Instalar no iPhone"
      description="Leva dois toques, direto pelo Safari."
      size="sm"
    >
      <ol className="space-y-3">
        <li className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
            1
          </span>
          {/* Fluxo de texto normal, não flex: como itens de flex, a vírgula e o
              ponto final se soltariam para a linha seguinte. */}
          <span className="pt-0.5 text-[14px] leading-relaxed text-ink-muted">
            Toque em{' '}
            <IosShareIcon size={17} className="inline align-[-4px] text-brand" />{' '}
            <strong className="font-medium text-ink">Compartilhar</strong>, na barra do Safari.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
            2
          </span>
          <span className="pt-0.5 text-[14px] leading-relaxed text-ink-muted">
            Role e escolha{' '}
            <PlusIcon size={16} className="inline align-[-3px] text-brand" />{' '}
            <strong className="font-medium text-ink">Adicionar à Tela de Início</strong>.
          </span>
        </li>
      </ol>
      <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-subtle">
        Precisa ser pelo <strong className="font-medium">Safari</strong>. No Chrome do iPhone a
        opção não aparece — é uma limitação do iOS, não do site.
      </p>
    </Modal>
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
      <IosInstallDialog open={showIos} onClose={() => setShowIos(false)} />
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
      <IosInstallDialog open={showIos} onClose={() => setShowIos(false)} />
    </>
  );
}
