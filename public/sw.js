// Onda Player Service Worker —— 桌面化（第 8 阶段）
// 只负责「应用外壳」的可安装性与离线兜底：
//  - 音乐/歌词内容由 File System Access 句柄实时读取（blob URL），不经过本 SW，永不缓存
//  - 零外部请求原则不变：只处理同源 GET
const VERSION = 'onda-shell-v1'
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/logo/onda-icon-192.png', '/logo/onda-icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 页面导航：网络优先，离线回退外壳（index.html 与 / 均指向缓存外壳）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((cache) => cache.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    )
    return
  }

  // 带扩展名的静态资源（构建产物为内容哈希文件名）：缓存优先，未命中时回填缓存
  if (url.pathname.includes('.') && url.pathname !== '/') {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((cache) => cache.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
  // 其余同源请求（如 dev 热更新）直接放行网络
})
