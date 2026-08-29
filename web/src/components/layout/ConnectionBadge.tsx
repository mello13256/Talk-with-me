import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { useSocket } from '@/context/SocketContext';
import { Spinner } from '@/components/ui/Spinner';
import { WifiOffIcon } from '@/components/ui/icons';

/**
 * Only surfaces when something is wrong. A short grace period keeps a one-second
 * blip during a reconnect from flashing a banner at the user.
 */
export function ConnectionBadge() {
  const { state } = useSocket();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state === 'online') {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 px-4 py-1.5 text-[12px] font-medium',
        state === 'connecting'
          ? 'bg-warning-soft text-warning'
          : 'bg-danger-soft text-danger',
      )}
    >
      {state === 'connecting' ? (
        <>
          <Spinner size={13} />
          Reconectando…
        </>
      ) : (
        <>
          <WifiOffIcon size={14} />
          Sem conexão em tempo real — suas mensagens serão enviadas quando voltar.
        </>
      )}
    </div>
  );
}
