/* MegaFauna Casebook: keeps the app working without a signal.
   Only the app's own files are kept here. Cases never pass through: they
   are never fetched, and live encrypted in the browser's storage.
   Network first, so people always get the latest version when they're
   online, with the saved copy as a fallback. Change CACHE whenever the
   app's files change. */

const CACHE = 'megafauna-casebook-v1';
const FILES = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/ui.js',
  'js/db.js',
  'js/vault.js',
  'js/model.js',
  'js/sha256.js',
  'js/exif.js',
  'js/examples.js',
  'fonts/dm-sans-latin.woff2',
  'fonts/fraunces-latin.woff2',
  'icons/logo.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const SCOPE = new URL('./', self.location).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('megafauna-casebook-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((cached) => cached || (request.mode === 'navigate' ? caches.match('./') : undefined))
        .then((cached) => cached || Response.error()))
  );
});
