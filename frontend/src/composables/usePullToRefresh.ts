/**
 * 下拉刷新（P27）
 *
 * <p>刻意**自己实现**而不用浏览器自带的那个：自带的那套会显示浏览器 UI，
 * 且在 Android Chrome 上与系统级的手势/滚动惯性打架 —— 表现是「有时候弹出来
 * 有时候不弹」。自己实现还能把触发条件收紧到「列表页顶部」。
 *
 * <p>⚠️ **必须同时关掉浏览器自带的下拉刷新**（{@link usePullToRefresh} 会打
 * `overscroll-behavior-y: contain`）：两者都在的话，用户看到的是自己的指示器
 * 与浏览器指示器**叠在一起**。
 *
 * <p>触发条件比想象中严格：必须在滚动位置为 0、**且方向向下**、且位移超过阈值。
 * 少了「位置为 0」这一条，用户在页中间想刷新一下就会把整个页面往下拽。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 超过这个位移（px）才算「松手就刷新」 */
const TRIGGER = 72
/** 指示器自己最多下拉多少，避免把内容拽得太离谱 */
const MAX_PULL = 110
/** 超过这个速度就算快速下滑（即使位移不够也刷新）—— 与原生手感一致 */
const VELOCITY = 0.5

export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  /** 当前下拉位移（px），0 表示未激活 */
  const pull = ref(0)
  /** 是否正在刷新（此时禁用再次触发） */
  const refreshing = ref(false)
  /** 是否已经达到「松手就刷新」的阈值 —— 指示器据此换颜色 */
  const armed = ref(false)

  let startY = 0
  let startT = 0
  let tracking = false
  let lastStyle = ''

  /** 页面是否在顶部。scrollY 在 iOS 上是负值（橡皮筋），所以一起判 */
  function atTop(): boolean {
    return Math.max(0, window.scrollY) <= 0
  }

  function onTouchStart(e: TouchEvent) {
    if (refreshing.value || !atTop() || e.touches.length !== 1) {
      tracking = false
      return
    }
    tracking = true
    startY = e.touches[0].clientY
    startT = Date.now()
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking || refreshing.value) return
    const dy = e.touches[0].clientY - startY
    // 向上推、或已经在底部区域 —— 都不触发
    if (dy <= 0) {
      pull.value = 0
      armed.value = false
      return
    }
    // 阻尼：越往下拉越沉，模拟原生那种「拉不动」的手感
    const damped = Math.min(MAX_PULL, dy * 0.5)
    pull.value = damped
    armed.value = damped >= TRIGGER
    // ⚠️ 必须 preventDefault，否则移动端浏览器会接管成原生下拉刷新，
    // 于是我们的指示器与浏览器的**同时**出现。
    if (window.scrollY <= 0 && e.cancelable) e.preventDefault()
  }

  async function onTouchEnd() {
    if (!tracking) return
    tracking = false
    const dy = pull.value
    const elapsed = Math.max(1, Date.now() - startT)
    const velocity = dy / elapsed
    pull.value = 0
    armed.value = false

    if (dy < TRIGGER && velocity < VELOCITY) return

    refreshing.value = true
    // 指示器转圈：给一个最小位移，不给的话它会先「弹回顶部再转圈」，
    // 看起来像闪了一下
    try {
      await onRefresh()
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    lastStyle = document.body.style.overscrollBehaviorY
    // 关掉浏览器自带的下拉刷新（iOS 上关不掉，但至少不会再与它叠加提示）
    document.body.style.overscrollBehaviorY = 'contain'
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
  })

  onBeforeUnmount(() => {
    // ⚠️ 必须还原：这是全局样式。不还原的话离开这个页面之后，
    // 整个应用（详情页、发布页…）的下拉刷新手感都被改了。
    document.body.style.overscrollBehaviorY = lastStyle
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('touchcancel', onTouchEnd)
  })

  return { pull, refreshing, armed, TRIGGER }
}
