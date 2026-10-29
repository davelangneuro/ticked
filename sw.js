// Service worker: offline support + push notifications.
const CACHE = 'ticked-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'config.js', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/core.js', 'js/celebrate.js', 'js/stats.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/badge-72.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App files: network first (always fresh), cache as offline fallback.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || caches.match('index.html');
      }
    })());
    return;
  }

  // The sync library from the CDN never changes for a pinned version: cache first.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Ticked', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Ticked', {
    body: data.body || '',
    tag: data.tag,
    renotify: !!data.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-72.png',
    data: { taskId: data.taskId || null },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const taskId = e.notification.data?.taskId;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all[0];
    if (client) {
      await client.focus();
      if (taskId) client.postMessage({ type: 'open-task', taskId });
    } else {
      await self.clients.openWindow('./#tasks');
    }
  })());
});
