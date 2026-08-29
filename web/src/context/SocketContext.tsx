import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

export type ConnectionState = 'connecting' | 'online' | 'offline';

interface SocketContextValue {
  socket: Socket | null;
  state: ConnectionState;
  /** Subscribes to a server event and unsubscribes on unmount. */
  on: <T>(event: string, handler: (payload: T) => void) => () => void;
  emit: (event: string, payload?: unknown) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

const SOCKET_URL = import.meta.env.VITE_API_URL || undefined;

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setState('offline');
      return;
    }

    // The handshake carries the session cookie; there is no token to pass here.
    const socket = io(SOCKET_URL ?? '', {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      // Exponential backoff with jitter: a server restart does not produce a
      // thundering herd, and the client keeps trying indefinitely.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 15_000,
      randomizationFactor: 0.5,
      timeout: 12_000,
    });

    socketRef.current = socket;
    forceRender((value) => value + 1);
    setState('connecting');

    socket.on('connect', () => setState('online'));
    socket.on('disconnect', () => setState('offline'));
    socket.on('connect_error', () => setState('offline'));
    socket.io.on('reconnect_attempt', () => setState('connecting'));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  // Reconnect promptly when a phone comes back from the lock screen.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible' && socketRef.current?.disconnected) {
        socketRef.current.connect();
      }
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, []);

  const value = useMemo<SocketContextValue>(
    () => ({
      socket: socketRef.current,
      state,
      on: <T,>(event: string, handler: (payload: T) => void) => {
        const socket = socketRef.current;
        if (!socket) return () => undefined;
        socket.on(event, handler as (...args: unknown[]) => void);
        return () => {
          socket.off(event, handler as (...args: unknown[]) => void);
        };
      },
      emit: (event: string, payload?: unknown) => {
        socketRef.current?.emit(event, payload);
      },
    }),
    [state],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used inside SocketProvider');
  return context;
}

/** Subscribes to a realtime event for the lifetime of the calling component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener as (...args: unknown[]) => void);
    return () => {
      socket.off(event, listener as (...args: unknown[]) => void);
    };
  }, [socket, event]);
}
