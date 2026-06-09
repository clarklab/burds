/* Burds service worker — offline support + cache busting.
 *
 * HOW THE CACHE BUSTER WORKS:
 *   Bump CACHE_VERSION below whenever you ship changed assets. The browser
 *   re-fetches sw.js on every load (and whenever the page asks it to —
 *   see the registration in index.html, which re-checks on `online`/focus).
 *   A changed CACHE_VERSION means a new cache name, so the new worker
 *   precaches the fresh files from the network, deletes the old cache on
 *   activate, takes control, and the page reloads onto the new build.
 *   That's the whole "push changes when the user regains internet" story.
 */
const CACHE_VERSION = 'v11';
const CACHE_NAME = `burds-${CACHE_VERSION}`;

// Everything needed to boot and play with zero network.
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './logo.webp',
  './icon-192.webp',
  './icon-512.webp',
  './apple-touch-icon.png',
  './favicon-48.png',
  './vendor/three.module.js',
  './src/main.js',
  './src/world.js',
  './src/models.js',
  './src/levels.js',
  './src/input.js',
  './src/audio.js',
  './src/effects.js',
  './src/scores.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // `cache: 'reload'` bypasses the HTTP cache so a version bump always pulls
    // the genuinely new bytes, not a stale browser-cached copy. We precache
    // resiliently (allSettled, not addAll) so a single flaky fetch on a spotty
    // mobile connection can't abort the whole update — any file that misses is
    // simply re-fetched and cached on demand by the fetch handler below.
    await Promise.allSettled(
      ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    // Activate this build immediately rather than waiting for every tab to be
    // closed. Without this a freshly-deployed worker can sit "waiting" forever
    // (the usual reason a new version refuses to show up on mobile). Paired with
    // the controllerchange reload in index.html, a new deploy now takes over on
    // the next load with a connection — no manual cache-clearing needed.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('burds-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// The page tells a freshly-installed worker to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through
  // Never cache the leaderboard API — it must always hit the live function so
  // global scores stay fresh (and POSTs are already skipped above).
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached; // cache-first: instant, works offline

    try {
      const response = await fetch(request);
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    } catch (err) {
      // Offline and uncached: fall back to the app shell for navigations.
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
