/**
 * 软键盘占位高度，写进 --kb-inset（px）。
 *
 * 为什么需要：详情页的评论输入在 <main class="page"> 里 position:fixed 吸底。
 * Android Chrome 上只要 viewport meta 带 interactive-widget=resizes-content，
 * 键盘弹起时 layout viewport 自己收缩，fixed 元素自动落到键盘上方，--kb-inset
 * 恒为 0；iOS Safari 不收缩这个 viewport，fixed 元素会留在键盘**后面** ——
 * 用户反馈的"输入文字有遮挡"就是它。这里读 visualViewport 把差额补上。
 *
 * 写 CSS 变量而不是直接改元素样式：吸底栏和 .page 的 padding-bottom 都要用
 * 这同一个值，两处各写一遍必然漂移（它们本来就必须相等）。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'

const READ_FN = 'visualViewport' in window ? window.visualViewport : null

/**
 * 键盘高度的**下限阈值**（px）。
 *
 * <p>为什么需要：视觉视口比布局视口小**不一定**是键盘造成的 —— 桌面浏览器把窗口
 * 拖出屏幕、页面缩放、某些浏览器的默认工具栏收放，都会让
 * `visualViewport.height < innerHeight`，于是一个 20~80px 的差值被当成键盘，
 * 吸底栏会无缘无故抬起、页面末尾多出一截空白。
 *
 * <p>手机上没有一种软键盘比 150px 还矮（最小的高度行/数字键盘都远大于此），
 * 所以这个阈值不会漏掉真键盘，却能滤掉全部这类假阳性。
 */
const MIN_KEYBOARD_PX = 150

function currentInset(): number {
  if (!READ_FN) return 0
  // innerHeight 是 layout viewport；height/offsetTop 是 visual viewport 的
  // 差值就是「被键盘盖住的那一截」，负值说明键盘往下探
  const inset = window.innerHeight - READ_FN.height - READ_FN.offsetTop
  // 噪声与符号抖动直接吃掉；低于阈值的当没有键盘
  return inset >= MIN_KEYBOARD_PX ? Math.round(inset) : 0
}

/** target 传元素 ref：值可能还没挂上，所以每次读 .value 而不是闭包捕获 */
export function useKeyboardInset(target: Ref<HTMLElement | null>) {
  let frame = 0

  function apply() {
    frame = 0
    target.value?.style.setProperty('--kb-inset', `${currentInset()}px`)
  }

  function schedule() {
    if (frame) return
    frame = requestAnimationFrame(apply)
  }

  onMounted(() => {
    apply()
    if (!READ_FN) return
    READ_FN.addEventListener('resize', schedule)
    READ_FN.addEventListener('scroll', schedule)
  })

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
    READ_FN?.removeEventListener('resize', schedule)
    READ_FN?.removeEventListener('scroll', schedule)
  })
}
