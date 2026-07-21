const CACHE_NAME = 'xmind-preview-v3'
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

  // 在线时优先获取最新应用资源；离线时才使用上次成功缓存的版本。
  event.respondWith(
    fetch(request)
      .then(response => {
        if (!response || response.status !== 200) return response
        const copy = response.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        return response
      })
      .catch(() => caches.match(request))
  )
})
