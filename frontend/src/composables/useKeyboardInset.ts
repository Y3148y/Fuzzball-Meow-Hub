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

function currentInset(): number {
  if (!READ_FN) return 0
  // innerHeight 是 layout viewport，height/offsetTop 是 visual viewport 的
  // 可见区；键盘弹起时后者变小，差额就是键盘盖住的高度
  const inset = window.innerHeight - READ_FN.height - READ_FN.offsetTop
  // 负值（地址栏收缩等）按 0 处理，否则吸底栏会被顶上去
  return inset > 0 ? Math.round(inset) : 0
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
