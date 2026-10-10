/**
 * 未读私信数 —— 模块级单例，会话列表页角标与「我的」页的私信行共用一份
 *
 * <p>与 {@link useUnreadCount}（通知未读数）是**两套独立单例**，刻意不合并：
 * 两个数字来自两个接口、两个表、两种「未读」。合并成一个 ref 就得在
 * 每次刷新时判断「这次刷的是通知还是私信」，而调用点本来就分属两个组件，
 * 合并只会让两边都要传一个 flag —— 正是 AGENTS 里那条
 * 「同一套语义塞进一个模型」的典型坏味道。
 *
 * <p>轮询周期 15s：比通知的「不轮询」重。私信是**双向**的 ——
 * 对方在不在页面你不知道，而「我发了消息 TA 什么时候看到」是私信的核心体验。
 * 15s 是延迟与耗电的折中；真要做到秒级需要 WebSocket + nginx Upgrade 配置，
 * 那是另一个量级的运维面（见 P22 段的取舍说明）。
 */
import { ref } from 'vue'
import { unreadCount } from '@/api/message'

/** 模块级：所有 import 这个模块的地方拿到的是同一个 ref */
const unread = ref(0)

let inflight: Promise<void> | null = null

export function useMessageUnread() {
  return { unread, refresh: refreshUnread, setZero: markAllZero, decrease }
}

/**
 * 拉未读私信数
 *
 * <p>并发去重：会话页与「我的」页可能同时挂载，同时触发就共用同一个
 * in-flight Promise。失败时**不抛** —— 角标不该把错误暴露给用户。
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

/** 读完一个会话后本地减掉它的条数，省掉一次往返 */
function decrease(n: number): void {
  unread.value = Math.max(0, unread.value - n)
}

/** 全部已读之后本地直接归零 */
function markAllZero(): void {
  unread.value = 0
}