// Service worker minimal pour rendre l'app "installable" (PWA).
// Il ne met rien en cache : il laisse simplement passer les requêtes réseau.
// Le fait qu'il soit enregistré et actif suffit pour que Chrome/Edge/Android
// proposent l'installation native (icône dans la barre d'adresse).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
});
