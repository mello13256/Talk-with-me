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

/** Qual menu o usuário precisa abrir quando o navegador não oferece o diálogo. */
export type ManualPlatform = 'ios' | 'other';

export type InstallState =
  /** Já está rodando como aplicativo — nada a oferecer. */
  | { kind: 'installed' }
  /** O navegador aceita instalar com um toque. */
  | { kind: 'ready'; install: () => Promise<boolean> }
  /** Sem API disponível: resta ensinar o caminho pelo menu do navegador. */
  | { kind: 'manual'; platform: ManualPlatform }
  /** Computador, ou navegador onde instalar não faz sentido. */
  | { kind: 'unavailable' };

/**
 * Quanto esperar pelo `beforeinstallprompt` antes de desistir e ensinar o
 * caminho manual. O evento costuma chegar logo após o registro do service
 * worker; mostrar as instruções antes disso trocaria um toque só pelo passo a
 * passo justamente em quem teria a experiência boa.
 */
const PROMPT_GRACE_MS = 2500;

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
 * Instalar na tela inicial só faz sentido num aparelho de mão. Num computador,
 * oferecer o passo a passo seria ruído.
 */
const isHandheld = (): boolean =>
  isAppleMobile() || (/Android|Mobile/.test(navigator.userAgent) && navigator.maxTouchPoints > 0);

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
    // O iOS nunca dispara o evento; não há o que esperar.
    if (isAppleMobile()) return 'manual';
    // Nos demais, começa em branco e espera o evento: só depois da carência é
    // que vale ensinar o caminho manual.
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

    /*
     * Rede de segurança para o celular cujo navegador nunca oferece o diálogo:
     * Firefox e algumas versões do Samsung Internet não implementam a API, e o
     * próprio Chrome pode não disparar o evento. Sem isto o usuário não via
     * absolutamente nada e tinha de descobrir sozinho o menu do navegador —
     * que é justamente o que este botão existe para evitar.
     */
    const timer = window.setTimeout(() => {
      setState((current) => (current === 'unavailable' && isHandheld() ? 'manual' : current));
    }, PROMPT_GRACE_MS);

    return () => {
      window.clearTimeout(timer);
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
  if (state === 'manual') {
    return { kind: 'manual', platform: isAppleMobile() ? 'ios' : 'other' };
  }
  return { kind: state };
}
