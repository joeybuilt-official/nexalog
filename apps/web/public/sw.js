importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');

const { registerRoute } = workbox.routing;
const { NetworkFirst, CacheFirst, StaleWhileRevalidate, NetworkOnly } = workbox.strategies;
const { CacheableResponsePlugin } = workbox.cacheableResponse;
const { ExpirationPlugin } = workbox.expiration;

// HTML — NetworkFirst (fallback to offline page)
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'pages',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
    networkTimeoutSeconds: 3,
  })
);

// Next.js static assets — CacheFirst
registerRoute(
  ({ url }) => url.pathname.startsWith('/_next/static/'),
  new CacheFirst({
    cacheName: 'next-static',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 200 }),
    ],
  })
);

// Stale-while-revalidate for key API routes
registerRoute(
  ({ url }) =>
    ['/api/today/cards', '/api/themes/forest', '/api/queue'].some(p =>
      url.pathname.startsWith(p)
    ),
  new StaleWhileRevalidate({ cacheName: 'api-swr' })
);

// Everything else — NetworkOnly
registerRoute(() => true, new NetworkOnly());

// Offline fallback for navigation
workbox.routing.setCatchHandler(({ event }) => {
  if (event.request.mode === 'navigate') {
    return caches.match('/offline');
  }
  return Response.error();
});
