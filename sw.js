// Guarda os arquivos do app para abrir rápido e funcionar sem internet.
// Os dados da planilha (outro domínio) não passam por aqui.
var VERSAO = 'faxina-v2';
var ARQUIVOS = [
  './', 'index.html', 'estilo.css', 'app.js', 'rotacao.js', 'config.js', 'manifest.webmanifest',
  'icones/icone.svg', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (chaves) {
    return Promise.all(chaves.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

// Rede primeiro (pega atualizações), cache se estiver sem internet.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      var copia = r.clone();
      caches.open(VERSAO).then(function (c) { c.put(e.request, copia); });
      return r;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});
