// おとはた — Service Worker（オフライン対応・cache-first）
// バージョンを上げると次回アクセスで全キャッシュが更新される。
const VERSION = 'otohata-v1';
const FILES = [
  './',
  './index.html',
  './style.css',
  './chords.js',
  './piano.js',
  './store.js',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// network-first: オンラインなら常に最新、オフラインはキャッシュで動く
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok && e.request.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then((hit) => hit || caches.match('./index.html'))
      )
  );
});
