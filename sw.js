// Service Worker — PWA + notificações locais de escala
const CACHE = 'ibn-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Clique na notificação → abre o site
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Mensagem da página para exibir notificação (mesmo com aba em segundo plano)
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'MOSTRAR_NOTIFICACAO' && d.titulo) {
    event.waitUntil(
      self.registration.showNotification(d.titulo, {
        body: d.corpo || '',
        icon: d.icon || './icons/icon-192.png',
        badge: d.icon || './icons/icon-192.png',
        data: { url: d.url || './index.html' },
        tag: d.tag || 'ibn-escala',
        requireInteraction: !!d.requireInteraction
      })
    );
  }
});
