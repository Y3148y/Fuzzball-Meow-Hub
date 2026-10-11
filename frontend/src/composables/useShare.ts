/**
 * 分享（P24）
 *
 * <p>刻意做**一层**而不是每次调用处各写一遍：降级链条（原生分享 → 复制链接）
 * 有三个坑，集中一处才改得动：
 *
 * <ol>
 *   <li>{@code navigator.share} 只在<b>安全上下文</b>（HTTPS 或 localhost）里存在，
 *       而且<b>桌面 Chrome/Edge 上根本没有</b>（Firefox 与桌面 Safari 也没有）。
 *       所以「有没有它」不能靠 UA 判断，必须先 {@code typeof navigator.share === 'function'}。</li>
 *   <li>调用 {@code navigator.share} 会在<b>用户手势</b>的同一 tick 里异步执行，
 *       一旦中间 await 过一次（比如先弹 toast），iOS 就会抛
 *       {@code NotAllowedError: Share must be initiated by a user gesture} ——
 *       而症状是「点了没反应」，与真因隔了两层。</li>
 *   <li>{@code navigator.clipboard} 同样要安全上下文，且在非用户手势里可能被拒，
 *       所以复制路径要带 {@code document.execCommand} 兜底。</li>
 * </ol>
 */
import { showToast } from 'vant'

/** 结果类型，调用方据此决定要不要提示「已复制」而不是「已分享」 */
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export function useShare() {
  /** 是否支持原生分享面板（而不是所有平台都走复制兜底） */
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  /**
   * 分享一条链接
   *
   * @param title 分享标题（原生面板里作为标题展示）
   * @param text  分享正文摘要
   * @param url   链接，缺省用当前地址
   */
  async function share(title: string, text?: string, url?: string): Promise<ShareResult> {
    const target = url ?? window.location.href

    if (canNativeShare) {
      try {
        // ⚠️ 这里**不能有任何 await**：原生分享必须在用户手势的同一 tick 内发起
        await navigator.share({ title, text, url: target })
        return 'shared'
      } catch (e) {
        // 用户点「取消」不算失败 —— 这时降级到复制反而是错的（他明确不要分享）
        if (e instanceof DOMException && e.name === 'AbortError') {
          return 'cancelled'
        }
        // 其余（NotAllowedError / 其它）落到复制兜底
      }
    }
    // ⚠️ 这里**必须 await**：`copy()` 返回 Promise<boolean>，
    // 而 Promise 对象**永远为真**，漏掉 await 时三元恒走 'copied' 分支 ——
    // 复制失败也会提示「链接已复制」，用户点开发现是旧地址。
    // TS2801 把它当类型错误报出来，实际是一个运行时 bug。
    return (await copy(target)) ? 'copied' : 'failed'
  }

  async function copy(text: string): Promise<boolean> {
    // ⚠️ 必须把它**局部重新声明成可选**才能写出有意义的判空：
    // lib.dom.d.ts 里 `navigator.clipboard` 的类型是 `Clipboard`（非可选），
    // 所以 `if (navigator.clipboard)` 与 `navigator.clipboard?.writeText &&`
    // 都会被 TS 判成恒真（TS2801）—— 而运行时它**真的**可能不存在
    // （非安全上下文的老 Safari、Firefox 的非 HTTPS 页面）。
    // 这类「类型比现实宽」的地方，用局部交叉类型把它收窄，而不是删掉判断。
    const clip = (navigator as Navigator & { clipboard?: Clipboard }).clipboard
    try {
      if (clip && typeof clip.writeText === 'function') {
        await clip.writeText(text)
        return true
      }
    } catch {
      // 非安全上下文 / 权限被拒，走下面的老办法
    }
    return legacyCopy(text)
  }

  /** 兜底：navigator.clipboard 不可用时的老办法（需要文档里有可聚焦的临时节点） */
  function legacyCopy(text: string): boolean {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      // 必须**在视口内但不可见**：display:none 的元素无法被选中，
      // 而 position:fixed + top:-9999px 在部分移动端浏览器里会触发页面滚动
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;'
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, ta.value.length)
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  /** 分享并给出对应提示。**返回结果**让调用方在测试里能断言走到哪条分支 */
  async function shareWithToast(title: string, text?: string, url?: string): Promise<ShareResult> {
    const r = await share(title, text, url)
    if (r === 'copied') {
      showToast({ message: '链接已复制', icon: 'success' })
    } else if (r === 'failed') {
      showToast({ message: '复制失败，请手动复制地址栏', type: 'fail' })
    }
    // shared / cancelled 都不提示：原生面板已经给了反馈
    return r
  }

  return { canNativeShare, share, shareWithToast }
}