import { useCallback, useEffect, useState } from 'react';

/**
 * O evento que o Chrome dispara quando julga o site instalável. Não está na
 * biblioteca de tipos padrão porque não é padronizado — só navegadores baseados
 * no Chromium o implementam.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    /**
     * Preenchido por um script no index.html. O evento chega antes do React
     * montar e só é disparado uma vez: sem capturá-lo cedo, a oportunidade de
     * instalar se perde e o botão nunca aparece.
     */
    __installPrompt?: BeforeInstallPromptEvent | null;
  }
}

export type InstallState =
  /** Já está rodando como aplicativo — nada a oferecer. */
  | { kind: 'installed' }
  /** O navegador aceita instalar com um toque. */
  | { kind: 'ready'; install: () => Promise<boolean> }
  /** iPhone e iPad: não existe API, o caminho é manual pelo menu Compartilhar. */
  | { kind: 'manual' }
  /** Navegador sem suporte, ou ainda não considerou o site instalável. */
  | { kind: 'unavailable' };

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // Safari no iOS não expõe display-mode; usa esta propriedade própria.
  (window.navigator as { standalone?: boolean }).standalone === true;

const isAppleMobile = (): boolean => {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  // iPad se identifica como Mac desde o iPadOS 13; a tela sensível ao toque é
  // o que o separa de um Mac de verdade.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
};

/**
 * Estado do convite para instalar o app.
 *
 * Três caminhos, porque as plataformas divergem: o Chromium entrega um diálogo
 * nativo, o Safari só permite pelo menu do sistema, e um aplicativo já
 * instalado não deve oferecer nada.
 */
export function useInstallPrompt(): InstallState {
  const [state, setState] = useState<InstallState['kind']>(() => {
    if (typeof window === 'undefined') return 'unavailable';
    if (isStandalone()) return 'installed';
    if (window.__installPrompt) return 'ready';
    if (isAppleMobile()) return 'manual';
    return 'unavailable';
  });

  useEffect(() => {
    // O evento pode chegar depois da montagem: o Chrome só o dispara quando
    // conclui que o site é instalável, o que envolve buscar o manifest e
    // registrar o service worker.
    const onAvailable = (event: Event) => {
      event.preventDefault();
      window.__installPrompt = event as BeforeInstallPromptEvent;
      setState((current) => (current === 'installed' ? current : 'ready'));
    };
    const onInstalled = () => {
      window.__installPrompt = null;
      setState('installed');
    };

    window.addEventListener('beforeinstallprompt', onAvailable);
    window.addEventListener('appinstalled', onInstalled);

    // Instalar pelo menu do navegador, em vez do nosso botão, também precisa
    // fazer o convite sumir.
    const display = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => isStandalone() && setState('installed');
    display.addEventListener('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onAvailable);
      window.removeEventListener('appinstalled', onInstalled);
      display.removeEventListener('change', onDisplayChange);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const event = window.__installPrompt;
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // O evento serve uma única vez. Recusado, o navegador decide sozinho se
    // oferece de novo mais tarde.
    window.__installPrompt = null;
    if (outcome === 'accepted') {
      setState('installed');
      return true;
    }
    setState('unavailable');
    return false;
  }, []);

  if (state === 'ready') return { kind: 'ready', install };
  return { kind: state };
}
