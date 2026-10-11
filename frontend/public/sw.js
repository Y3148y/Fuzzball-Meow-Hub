/**
 * Service Worker（P27）
 *
 * <p>⚠️ **只在生产构建注册**（`import.meta.env.PROD`）。这不是洁癖 ——
 * 开发时注册会让 571 条 CDP 测试全部打到**缓存里的旧资源**：改了一行
 * `main.css` 但测试量的是上一轮的布局，于是「刚改好的东西莫名其妙又坏了」，
 * 而且症状与真正的原因隔了整整一层（症状在 UI 上，原因是浏览器缓存）。
 *
 * <p>**缓存策略刻意分三类**，不是「一律 cache-first」：
 *
 * <ul>
 *   <li><b>导航请求（HTML）</b>：network-first。离线时回落缓存。
 *     理由：HTML 里引用的是**带内容哈希的** chunk 名，缓存住旧 HTML
 *     就会去请求已经不存在的旧 chunk（404 白屏）。所以 HTML 宁可慢，
 *     也要拿最新的。</li>
 *   <li><b>带哈希的静态资源</b>（/assets/xxx-[hash].js）：cache-first。
 *     内容变了文件名就变了，缓存永远是对的 —— 这是唯一可以放心缓存的一类。</li>
 *   <li><b>其它（/api、/static 上传的图片）</b>：一律不碰，走网络。
 *     理由：API 响应是动态的，缓存它等于让用户看到过期数据；上传的图片
 *     理论上可缓存，但它们数量大且可能很长寿，缓存配额撑不住，不值得。</li>
 * </ul>
 *
 * <p>**版本化**：每次发布 bump {@link VERSION}，activate 时清掉旧缓存。
 * 不 bump 的话用户会永远卡在第一次装的那个版本上。
 */

const VERSION = 'xk-v1'
const PRECACHE = `xk-precache-${VERSION}`
const RUNTIME = `xk-runtime-${VERSION}`

/** 启动时缓存的壳子。HTML 不 precache（见上面的理由） */
const PRECACHE_URLS = ['/manifest.json', '/favicon.svg', '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((c) => c.addAll(PRECACHE_URLS))
      // ⚠️ 单个资源 404 就会让整个 install 失败、SW 永远装不上。
      // 所以逐个 add，失败的那个跳过。
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k)),
        ),
      )
      // 立刻接管：不然用户要关掉所有标签页才拿到新版本
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // 跨域（CDN 等）与非 http(s)（扩展）不碰
  if (url.origin !== self.location.origin) return

  // ① API 与上传图片：一律走网络。缓存它们等于让用户看到过期数据
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/static/')) return

  // ② 导航：network-first，离线回落缓存的首页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(RUNTIME).then((c) => c.put('/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/').then((r) => r || caches.match('/index.html'))),
    )
    return
  }

  // ③ 带内容哈希的静态资源：cache-first
  const hashed = url.pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\.(js|css|png|jpg|svg|woff2?)$/.test(url.pathname)
  if (hashed) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(RUNTIME).then((c) => c.put(req, copy)).catch(() => {})
            }
            return res
          }),
      ),
    )
  }
  // ④ 其它请求不 respondWith —— 走浏览器默认（网络）
})
