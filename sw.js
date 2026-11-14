// Service worker: guarda los archivos de la app para que abra sin señal.
// No guarda datos: las llamadas a la planilla (otro dominio, POST) pasan de largo.
//
// Al cambiar cualquier archivo de la app, subí este número para que los
// celulares tomen la versión nueva.
const CACHE = 'roquitas-v2';

const ARCHIVOS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'api.js',
  'cola.js',
  'formato.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const pedido = e.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;

  // Responde con lo guardado y, si hay señal, actualiza la copia para la próxima vez.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardado = await cache.match(pedido, { ignoreSearch: true });
      const deRed = fetch(pedido)
        .then((r) => {
          if (r.ok) cache.put(pedido, r.clone());
          return r;
        })
        .catch(() => guardado);
      return guardado || deRed;
    })
  );
});
