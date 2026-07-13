// Hand-rolled service worker (roadmap M44; doc 03 §9, doc 05 asset manager,
// doc 10 pipeline diagram "service-worker cache (offline)"). No Workbox/build
// step — the same zero-dependency-by-default posture the rest of the repo
// keeps (hand-written JSON5 parser, hand-written validators, Node's own test
// runner). Cache-first for same-origin GET requests; a genuine cache miss
// (first-ever visit, or a URL never fetched before) falls through to the
// network and is cached for next time.
//
// CACHE_NAME is the whole versioning story: install/activate swap the cache
// atomically on a version bump — "update = new SW + cache swap on next
// launch" (doc 03 §9). No content-manifest-hash cache keys yet (doc 10's
// asset pipeline — atlas packer, content-hashed manifest — hasn't landed;
// this is the pragmatic slice ahead of it, per README's phase-by-phase scope).
//
// Fetch strategy: NETWORK-FIRST for navigations / the HTML shell, CACHE-FIRST for
// everything else. The shell (index.html) references build-hashed JS/CSS, so if the
// shell itself were served stale from cache a new deploy would never surface — the
// classic "my change didn't show up" trap. Fetching the shell from the network when
// online (cache only as an offline fallback) fixes that; the hashed assets it points
// at are immutable per build, so cache-first for them is both safe and fast.
//
// Saves are NEVER touched here: they live in IndexedDB (saveStore.ts), a
// storage the Cache API/service worker never sees — doc 03 §9's hard
// invariant ("saves are never stored in caches").
const CACHE_NAME = 'crowns-and-clay-shell-v2';
const SHELL_URLS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Navigations / the HTML shell: network-first so a new deploy is picked up immediately,
  // falling back to the cached shell only when offline.
  const isShell = request.mode === 'navigate' || new URL(request.url).pathname === '/';
  if (isShell) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Everything else (build-hashed JS/CSS/assets): cache-first, populate on first fetch.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached !== undefined) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
    }),
  );
});
