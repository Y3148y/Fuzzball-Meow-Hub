/**
 * 未读通知数 —— 模块级单例，铃铛（桌面 SiteNav）与「我的」页的通知行共用一份
 *
 * <p>为什么不各拉各的：两个组件都在的话就是两个请求、两份可能不一致的数字，
 * 点掉一条通知后还得各自同步。模块级 ref 让它们天然共享。
 *
 * <p>刷新时机：App.vue 在**每次路由切换后**调 {@link refreshUnread}，
 * 组件自己 onMounted 也调一次。刻意不做定时轮询 —— 本项目没有推送基础设施，
 * 而每 30s 轮询一次在低端机上也是实打实的耗电。
 */
import { ref } from 'vue'
import { unreadCount } from '@/api/notification'

/** 模块级：所有 import 这个模块的地方拿到的是同一个 ref */
const unread = ref(0)

let inflight: Promise<void> | null = null

export function useUnreadCount() {
  return { unread, refresh: refreshUnread, setZero: markAllZero }
}

/**
 * 拉未读数
 *
 * <p>并发去重：路由快速连切时可能同时触发多次，这里共用同一个 in-flight Promise。
 * 失败时**不抛** —— 顶栏角标不该把错误暴露给用户，下次路由切换会再试。
 */
async function refreshUnread(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      unread.value = await unreadCount()
    } catch {
      // 静默：保持上一次的值
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** 全部已读之后本地直接归零，省掉一次往返 */
function markAllZero(): void {
  unread.value = 0
}