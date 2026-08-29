import { api } from './api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const notificationPermission = (): NotificationPermission =>
  typeof Notification === 'undefined' ? 'denied' : Notification.permission;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/**
 * Asks for permission, then registers the endpoint server-side. Returns false
 * for every "not now" path (denied, unsupported, VAPID keys not configured) so
 * the UI can simply keep the toggle off.
 */
export async function enablePushNotifications(): Promise<boolean> {
  if (!pushSupported()) return false;

  const { enabled, publicKey } = await api.get<{ enabled: boolean; publicKey: string | null }>(
    '/notifications/push/public-key',
  );
  if (!enabled || !publicKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  if (!registration) return false;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const payload = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys.auth) return false;

  await api.post('/notifications/push/subscribe', {
    endpoint: payload.endpoint,
    keys: { p256dh: payload.keys.p256dh, auth: payload.keys.auth },
  });
  return true;
}

export async function disablePushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api.post('/notifications/push/unsubscribe', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/** In-tab notification for when the app is open but the tab is not focused. */
export function showLocalNotification(title: string, body: string, tag?: string): void {
  if (notificationPermission() !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
