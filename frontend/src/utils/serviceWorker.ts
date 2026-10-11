/**
 * 注册 service worker（P27）
 *
 * <p>⚠️ **开发时完全不注册**（{@link import.meta.env.PROD} 守卫）。
 * 这不是可有可无的优化：开发时注册 SW 会让 571 条 CDP 测试全部打到
 * **缓存里的旧资源** —— 改了一行 CSS 但测试量的是上一轮的布局，
 * 症状是「刚改好的东西莫名其妙又坏了」，而真因（浏览器缓存）离症状隔了整层。
 *
 * <p>另外浏览器只在**安全上下文**（HTTPS 或 localhost）里允许注册，
 * 所以局域网 IP 访问时会直接抛错 —— 那个要 catch 掉而不是让它冒泡，
 * 否则整页白屏（注册失败会中断后续逻辑，而它本来就不重要）。
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 注册失败不该有任何用户可见后果：没有 SW 的应用照样能用，
      // 只是慢一点。真的想排查再打开 console 提示。
    })
  })
}

/** 清掉已注册的 SW 与全部缓存。调试/排障用，正常流程不调用 */
export async function unregisterServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
  const keys = await caches.keys()
  await Promise.all(keys.map((k) => caches.delete(k)))
}
