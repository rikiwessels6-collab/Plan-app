// Offline cache. Pages: network first (so new versions appear), falling back to cache.
// Built assets have hashed names, so cache first is safe for them.
const CACHE = 'plan-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req)
      const fresh = () =>
        fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone())
          return res
        })
      if (req.mode === 'navigate') return fresh().catch(() => hit || cache.match('./'))
      return hit || fresh()
    }),
  )
})
