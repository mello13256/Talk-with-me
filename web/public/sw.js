/* Talk with me — service worker for Web Push notifications. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: 'Talk with me', body: 'Você recebeu uma nova mensagem.' };
  }

  const title = payload.title || 'Talk with me';
  const options = {
    body: payload.body || '',
    // PNG, não SVG: o Android não desenha SVG em notificação, e o aviso cairia
    // num ícone genérico do navegador em vez do ícone do canal.
    icon: '/icons/icon-192.png',
    // Símbolo pequeno da barra de status. O sistema o reduz a uma silhueta, daí
    // ser um desenho sólido e sem fundo.
    badge: '/icons/badge-72.png',
    // Collapses repeated notifications for the same conversation.
    tag: payload.tag || 'talk-with-me',
    renotify: true,
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  const url = target || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab when there is one instead of opening another.
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url !== url && 'navigate' in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
