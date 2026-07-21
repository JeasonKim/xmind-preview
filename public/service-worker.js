const CACHE_NAME = 'xmind-preview-v2'
const APP_SHELL = [
  '',
  'index.html',
  'manifest.webmanifest',
  'pwa-icon.svg',
  'assets/index.js',
  'assets/index.css',
].map(path => new URL(path, self.registration.scope).href)

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return

  const request = event.request.mode === 'navigate'
    ? new Request(new URL('index.html', self.registration.scope).href)
    : event.request

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (!response || response.status !== 200) return response
        const copy = response.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        return response
      })
    })
  )
})
