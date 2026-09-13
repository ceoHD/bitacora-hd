/* Service worker: lo que da el modo sin señal.
   Guarda la app en el teléfono la primera vez y desde entonces la sirve
   desde ahí. Las llamadas al portal nunca se cachean: o hay señal o la
   app las pone en la cola.                                             */

var CACHE = 'hd-bitacora-v1';
var ARCHIVOS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icono-192.png',
  './icono-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ARCHIVOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  // al portal se va siempre por la red: nunca se responde con datos viejos
  if (req.method !== 'GET' || req.url.indexOf('script.google.com') >= 0) return;

  // la app: primero lo guardado, y de fondo se busca una versión nueva
  e.respondWith(
    caches.match(req).then(function (guardado) {
      var red = fetch(req).then(function (r) {
        if (r && r.status === 200 && r.type === 'basic') {
          var copia = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return r;
      }).catch(function () { return guardado; });
      return guardado || red;
    })
  );
});
