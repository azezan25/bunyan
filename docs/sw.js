
const CACHE = 'binaa-shell-ff9d5a5d5dd4';
const SCOPE = self.registration.scope;
const FILES = ["index.html","assets/pdf.worker.min-iDqQPrd3.mjs","assets/index-CkBhlsFt.css","assets/index-kPNZ8xGM.js","logo.svg","apple-touch-icon.png","icon-192.png","icon-512.png","manifest.webmanifest"].map(p => new URL(p, SCOPE).href);
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('binaa-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (!url.startsWith(SCOPE)) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.open(CACHE).then(c => c.match(new URL('index.html', SCOPE).href))));
    return;
  }
  if (!FILES.includes(url)) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request))));
});
