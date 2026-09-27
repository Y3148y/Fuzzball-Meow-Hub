import { computed, ref } from 'vue'

/**
 * 深浅双模式。
 *
 * 为什么需要自己写：
 * Vant 4 的暗色是纯 class 驱动 —— 它只在 <html> 上加 `.van-theme-dark`，
 * 源码里搜不到任何 prefers-color-scheme 匹配（已验证 0 处），
 * 也就是说 Vant 不会自动跟随系统。这里用 matchMedia 把系统偏好接进来，
 * 再同步给两处：自己的 data-theme（驱动设计 token）和 Vant 的 class（驱动组件库）。
 *
 * 三种模式：
 * - light / dark 用户显式选择，写进 localStorage
 * - auto（默认）跟随系统，系统切换时实时响应
 *
 * 首屏防闪烁在 index.html 的内联脚本里做同样的事，
 * 必须在 Vue 挂载前把 class 打上，否则暗色用户会先看到一帧白底。
 */

export type ThemeMode = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'xk_theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 同步给浏览器 UI（地址栏、任务栏）的配色，配合 index.html 里的 meta */
const BROWSER_THEME = { light: '#f4f6fb', dark: '#444a71' } as const

const mode = ref<ThemeMode>('auto')
const systemDark = ref(false)
let inited = false

const isDark = computed(() => (mode.value === 'auto' ? systemDark.value : mode.value === 'dark'))

function apply() {
  const root = document.documentElement
  root.dataset.theme = isDark.value ? 'dark' : 'light'
  root.classList.toggle('van-theme-dark', isDark.value)

  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', isDark.value ? BROWSER_THEME.dark : BROWSER_THEME.light)
}

function setMode(next: ThemeMode) {
  mode.value = next
  if (next === 'auto') {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, next)
  }
  apply()
}

function toggle() {
  // 手动切换后就固定下来，不再跟随系统，避免用户刚点完又被系统改回去
  setMode(isDark.value ? 'light' : 'dark')
}

function init() {
  if (inited) return
  inited = true

  const saved = localStorage.getItem(STORAGE_KEY)
  mode.value = saved === 'light' || saved === 'dark' ? saved : 'auto'

  const mq = window.matchMedia(DARK_QUERY)
  systemDark.value = mq.matches
  mq.addEventListener('change', (e) => {
    systemDark.value = e.matches
    // 只有 auto 模式才跟随系统变化
    if (mode.value === 'auto') apply()
  })

  apply()
}

export function useTheme() {
  init()
  return { mode, isDark, setMode, toggle }
}
