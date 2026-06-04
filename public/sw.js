// Turf Time service worker — makes the app installable and gives a basic
// offline shell, WITHOUT risking stale builds:
//   • HTML navigations are network-first (always fresh online; cached shell
//     only as an offline fallback), so new deploys show up normally.
//   • Hashed static assets (immutable filenames) are cache-first for speed.
//   • Cross-origin requests (e.g. the Supabase API) are never touched.
const CACHE = 'turftime-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add('/index.html')).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // let the API & fonts pass straight through

  // App navigations: always try the network first; fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')))
    return
  }

  // Hashed static assets: serve from cache, fetch & cache on miss.
  if (/\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|gif|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ||
        fetch(request).then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy))
          return res
        })
      )
    )
  }
})
