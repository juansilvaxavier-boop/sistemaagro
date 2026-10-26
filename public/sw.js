// Service worker: guarda a "casca" do aplicativo para abrir rápido e funcionar como app instalado.
// A API nunca é guardada em cache (os dados sempre vêm do servidor).
const VERSAO = 'agt-v8';
const CASCA = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/core.js', '/img/icone.svg', '/img/logo.png', '/img/favicon.png', '/manifest.webmanifest',
  '/vendor/bootstrap/css/bootstrap.min.css', '/vendor/bootstrap/js/bootstrap.bundle.min.js', '/vendor/bootstrap-icons/bootstrap-icons.min.css',
  '/vendor/chart.js/chart.umd.js', '/vendor/fonte/index.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Rede primeiro (pega versões novas); cache como reserva quando estiver offline.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) caches.open(VERSAO).then((c) => c.put(e.request, r.clone()));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
// Lembretes enviados pelo servidor (Web Push), mesmo com o sistema fechado.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Acelera Fertilizantes', {
    body: d.corpo || '', icon: '/img/icone-192.png', badge: '/img/icone-192.png', data: { url: d.url || '/' }, tag: d.tag, renotify: !!d.tag,
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    const alvo = e.notification.data?.url || '/';
    for (const c of cs) { c.focus(); c.navigate?.(alvo); return; }
    return self.clients.openWindow(alvo);
  }));
});
