// Caches only immutable static files. API calls and pages always go to the network,
// so permissions and app data are never served from cache.
const CACHE = 'coship-static-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== location.origin ||
    !/^\/(assets|fonts|icons)\//.test(url.pathname)
  )
    return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }),
      ),
    ),
  );
});
