/* Service Worker — Kartenwerkstatt v4 */
const VERSION = 'werkstatt-v4.0.1';
const CORE = ['./', './index.html', './app.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Externes (Fonts, GitHub-API) unberührt lassen

  // Datendateien: Netz zuerst, Fallback Cache (offline lesbar)
  if (url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }
  // Navigation: App-Shell aus Cache, sonst Netz
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)));
    return;
  }
  // Übrige Assets: Stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
