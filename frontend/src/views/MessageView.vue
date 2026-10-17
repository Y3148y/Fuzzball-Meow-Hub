<script setup lang="ts">
/**
 * 私信聊天页
 *
 * <p>路由是 `/message/:id(\d+)`，**参数是对方的 userId 而不是 sessionId**。
 * 理由：进入页面的自然路径是「从某个人进入」，而会话 ID 是内部概念 ——
 * 让 URL 暴露它，用户从别人分享的链接进来就会指向别人的会话。
 *
 * <p>气泡左右靠 `senderId === myId` 判断，**不靠数组下标奇偶** ——
 * 翻页会把顺序打乱，按下标算的话加载更多之后同一句话会跳到另一边。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { messageHistory, readAllMessages, sendMessage } from '@/api/message'
import { uploadImage } from '@/api/note'
// 对方卡片用 follow 域的「一次往返拿全」端点（UserView 用的同一个），
// 不另开一个只返回昵称头像的新接口 —— 那会造出第二个形状相同的用户卡片
import { getUserFollowStatus } from '@/api/follow'
import { useMessageUnread } from '@/composables/useMessageUnread'
import { useUserStore } from '@/stores/user'
import EmojiPanel from '@/components/EmojiPanel.vue'
import type { MessageVO } from '@/api/types'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const peerId = computed(() => String(route.params.id ?? ''))
const myId = computed(() => userStore.userInfo?.id)

/**
 * 没有头像时显示什么 —— 全站约定：`avatar ?? '/mascot/m02.webp'`
 *
 * ⚠️ 这个约定在**同一个功能的隔壁**就已经这么写了：
 *   MessageListView「私信会话列表」 `:src="s.peerAvatar ?? '/mascot/m02.webp'"`
 *   NotificationView             `:src="n.actorAvatar ?? '/mascot/m02.webp'"`
 *   HomeView / ProfileView / UserView / FollowListView … 直接写死 m02
 * 2026-10-17 的 P35 却在聊天页发明了「三分支 v-if + 灰色空圆占位」，
 * 既违背约定，又让两侧都看不见头像（dev 库里 12 个账号 avatar 全是 NULL，
 * 所以「没有头像」是**常态而不是边缘情况** —— 兜底必须好看，
 * 因为几乎所有人看到的都是它）。
 *
 * ⚠️ 用 `||` 而不是 `??`：空串同样会让浏览器把 `src=""` 解析成当前页面 URL
 * 去请求（拿到 HTML 当图片解码 → 裂图 + alt 糊在气泡边）。`??` 放不掉空串。
 * 顺带的好处是**根本没有空串这条路径**，`src=""` 结构上不可能再发生。
 */
const MASCOT = '/mascot/m02.webp'

/** 自己这侧显示**我的**头像 —— 不是占位、也不是对方的脸。 */
const myAvatar = computed(() => userStore.userInfo?.avatar || MASCOT)
const myName = computed(
  () => userStore.userInfo?.nickname || userStore.userInfo?.username || '我')

const peerName = ref('对方')
const peerAvatar = ref<string | null>(null)
const list = ref<MessageVO[]>([])
const loading = ref(true)
const sending = ref(false)
const error = ref('')
const draft = ref('')

const scroller = ref<HTMLElement | null>(null)
const MAX_LEN = 1000

/* ================= P31：加载更多 + 失败重发 ================= */
/** 每页条数，与后端 PageVO 对齐 */
const PAGE_SIZE = 30
const page = ref(1)
const total = ref(0)
const loadingMore = ref(false)
/**
 * 还有更多历史吗？
 *
 * <p>⚠️ 必须要求 `total > 0`：刚进页面时 `total` 还是 0 而 `list` 也是空，
 * `list.length < total` → `0 < 0` 是 false，这没问题；但如果**接口只回了部分**
 * 或者 `total` 因任何原因没填上，`0 < 0` 之外的组合会让按钮凭空出现。
 * 显式带上 `total > 0` 就把「我根本没拿到总数」与「真的还有更多」区分开了。
 */
const hasMore = computed(() => total.value > 0 && list.value.length < total.value)

/** 发送失败的消息：留在界面上等重发，而不是弹个 toast 就消失 */
interface FailedMsg {
  key: string
  content: string
  imageUrl?: string
  error: string
}
const failed = ref<FailedMsg[]>([])
const uploading = ref(false)

/** 等两帧 rAF：确保浏览器完成布局与绘制，之后量到的才是稳定位置 */
function raf2(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/**
 * 往上滑到顶时加载更早的一页
 *
 * <p>⚠️ **必须保持滚动位置**：新消息插在前面，视口内容整体下移，
 * 用户看到的是「我明明没动，消息却自己往上跑」——那比加载不出来更糟。
 *
 * <p>做法不是「新高度 - 旧高度」那套算术，而是**抓住插入点那个元素**：
 * 插入前记下第一条已有消息的 DOM 引用，插入后把它滚回原来的视口位置。
 * 算术补偿的坑在于 `scrollHeight` 的测量时机 —— `nextTick` 只等 DOM 结构，
 * 不等图片解码与字体加载，那期间高度还在变，于是补偿量偏小、视口仍然下移
 * （CDP 实测 scrollTop 差了近 15000px）。抓元素则与测量时机无关。
 */
async function loadMore() {
  const el = scroller.value
  if (!el || loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  // ⚠️ 高度必须在**响应到达之后、插入之前**量，不能在发请求之前。
  // 请求在飞的那几百毫秒里，5s 一次的轮询可能刚好追加了新消息
  // （CDP 实测补偿量因此少算约 5900px，视口被顶走一半）。
  // 「发出前记基线」这个直觉写法在这里是错的 —— 两次量之间列表会变。
  let scrollTopBefore = el.scrollTop
  let prevHeight = el.scrollHeight
  try {
    const next = page.value + 1
    const res = await messageHistory(peerId.value, next, PAGE_SIZE)
    // 响应回来、还没插进 DOM —— 这才是正确的基线时刻
    scrollTopBefore = el.scrollTop
    prevHeight = el.scrollHeight
    const known = new Set(list.value.map((m) => m.id))
    const older = (res.list ?? []).filter((m) => !known.has(m.id))
    // 后端按时间**正序**返回（一页比一页早），所以直接前面拼
    if (older.length) list.value.unshift(...older)
    page.value = next
    total.value = res.total ?? total.value
    await nextTick()
    // ⚠️ **等两帧**再量高度：nextTick 只保证 DOM 结构建好，
    // 浏览器还没做布局 —— 此刻 scrollHeight 是旧的，算出来的补偿量是 0。
    // rAF × 2 = 一轮布局 + 一轮绘制之后，高度才是最终值。
    await raf2()
    // 插入后内容变高，把差值补回 scrollTop，视口就停在原来那批内容上。
    const grew = el.scrollHeight - prevHeight
    if (grew) el.scrollTop = scrollTopBefore + grew
  } catch {
    // 拉不动就停在原地，不打扰用户
  } finally {
    loadingMore.value = false
  }
}

function retryFailed(f: FailedMsg) {
  const i = failed.value.findIndex((x) => x.key === f.key)
  if (i >= 0) failed.value.splice(i, 1)
  void doSend(f.content, f.imageUrl, f.key)
}

/* ================= P32：图片消息 ================= */
const pickRef = ref<HTMLInputElement | null>(null)

function openPicker() {
  pickRef.value?.click()
}

/**
 * 选图 → 预览 → 上传 → 发消息
 *
 * <p>**刻意不自动发送**：选完图就发出去的话，用户还没来得及取消
 * 就已经把图传出去了 —— 发错一次比多按一次按钮糟糕得多。
 */
async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 无论成败都要清空，否则同一个文件再选一次不触发 change
  input.value = ''
  if (!file) return
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
    showToast('只能发 PNG / JPG / GIF / WebP 图片')
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('图片不能超过 10MB')
    return
  }
  uploading.value = true
  try {
    // ⚠️ uploadImage 返回的是 **ImageUploadVO 对象**，不是 URL 字符串。
    // 直接把它传给 doSend 会让 imageUrl 变成 "[object Object]"，
    // 后端 normalizeImageUrl 判为非法 → 50007（AGENTS P20 记过同一个坑）。
    const vo = await uploadImage(file)
    await doSend('', vo.url)
  } catch (err) {
    showToast(err instanceof Error ? err.message : '图片上传失败')
  } finally {
    uploading.value = false
  }
}

/** 点缩略图看大图 */
const previewUrl = ref<string | null>(null)

/* ================= P31：表情面板 ================= */
const emojiOpen = ref(false)

/**
 * 把表情插进输入框，**插在光标处**而不是末尾
 *
 * <p>用户已经打了半句话、想在中间插一个表情，追加到末尾就是错的。
 *
 * <p>⚠️ 用原生 setter 改值：直接 `el.value = x` 不触发 Vue 的 v-model，
 * `draft` 不更新、发送键也还是禁用（与 MentionPicker 同一个坑）。
 */
function insertEmoji(text: string) {
  const el = document.getElementById('msg-input') as HTMLTextAreaElement | null
  const at = el ? el.selectionStart ?? draft.value.length : draft.value.length
  draft.value = draft.value.slice(0, at) + text + draft.value.slice(el ? el.selectionEnd ?? at : at)
  void nextTick(() => {
    if (!el) return
    const pos = at + text.length
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

/** 轮询拉新消息；只在页面可见时跑 */
const POLL_MS = 5_000
let timer: ReturnType<typeof setInterval> | undefined

function scrollToBottom(smooth = false) {
  void nextTick(() => {
    const el = scroller.value
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await messageHistory(peerId.value, 1, PAGE_SIZE)
    list.value = res.list ?? []
    total.value = res.total ?? list.value.length
    page.value = 1
    // 进会话即已读。刻意不等待它完成再渲染：标已读是副作用，
    // 用户想看的是消息本身，卡住渲染等一个角标更新是本末倒置。
    void markRead()
    scrollToBottom()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function markRead() {
  try {
    const n = await readAllMessages(peerId.value)
    // 只清本地状态，不重拉历史 —— 重拉会把用户正在看的位置顶回底部
    list.value.forEach((m) => {
      if (m.receiverId === myId.value) m.isRead = 1
    })
    if (n > 0) useMessageUnread().decrease(n)
  } catch {
    // 标已读失败不该拦住我看消息
  }
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  draft.value = ''
  await doSend(content)
}

/**
 * 真正发一条
 *
 * <p>⚠️ **失败不吞**：私信发不出去是最让人无力的场景之一，
 * 而「弹个 toast 然后内容消失」等于让用户重新打一遍。
 * 小红书的做法是**把失败的气泡留在原地**，标红 + 一个「重新发送」，
 * 点一下原样再发。用户能看见它失败，也能看见它成功。
 */
async function doSend(content: string, imageUrl?: string, reuseKey?: string) {
  sending.value = true
  const key = reuseKey ?? 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  try {
    const msg = await sendMessage(peerId.value, content, imageUrl ? { type: 2, imageUrl } : {})
    // 重试成功：把那条失败记录换成真消息
    const i = failed.value.findIndex((x) => x.key === key)
    if (i >= 0) failed.value.splice(i, 1)
    else list.value.push(msg)
    scrollToBottom(true)
  } catch (e) {
    // ⚠️ 50004（对方拉黑了我）在这里才有意义 —— 它是**发送时**才暴露的，
    // 后端刻意不在别处提示（P18 原则：不暴露对方的操作）。
    // 但**不弹 toast 就消失**：私信发不出去是最让人无力的场景，
    // 让用户重打一遍 500 字比多一句解释糟糕得多。所以标红留在原地等重发。
    failed.value.push({ key, content, imageUrl, error: e instanceof Error ? e.message : '发送失败' })
    scrollToBottom(true)
  } finally {
    sending.value = false
  }
}

/** 轮询只追加**新**消息，不重排已有的 —— 否则用户正在看的那条会跳位 */
async function pollNew() {
  if (document.hidden || sending.value) return
  try {
    const res = await messageHistory(peerId.value, 1, PAGE_SIZE)
    const known = new Set(list.value.map((m) => m.id))
    const fresh = (res.list ?? []).filter((m) => !known.has(m.id))
    if (fresh.length) {
      const atBottom = isNearBottom()
      list.value.push(...fresh)
      // 用户已经翻上去看历史时**不要**把他拽回底部
      if (atBottom) scrollToBottom(true)
      void markRead()
    }
    if (res.total !== undefined) total.value = res.total
  } catch {
    // 静默：下一轮再试
  }
}

function isNearBottom(): boolean {
  const el = scroller.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function mine(m: MessageVO): boolean {
  return m.senderId === myId.value
}

/** 某一行的头像：自己这侧用我的，对方那侧用他的，都没有则吉祥物兜底。 */
function avatarOf(m: MessageVO): string {
  return (mine(m) ? userStore.userInfo?.avatar : peerAvatar.value) || MASCOT
}

function altOf(m: MessageVO): string {
  return mine(m) ? myName.value : peerName.value
}

/* ================= P31 对齐小红书：日期线 / 头像 / 时间戳 ================= */

/**
 * 把消息流切成「带日期分隔线的分段」
 *
 * <p>小红书（以及几乎所有 IM）在跨天处插一条居中的灰色日期线。
 * **只在跨天时才插**，不是每条都带 —— 每条都带就成了噪音。
 *
 * <p>⚠️ 分组必须用**稳定的分组键**而不是 `index`：切一次就会全部重建，
 * 用下标做 key 会在内容相同的相邻片段上撞 key（Vue 会警告且复用错节点）。
 */
type ChatRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'msg'; key: string; msg: MessageVO; time: string }

/** 本地时区的「今天 / 昨天 / 3月5日」—— 与 formatDateTime 同源，避免两套时区口径 */
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function dateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  if (dayKey(iso) === dayKey(today.toISOString())) return '今天'
  if (dayKey(iso) === dayKey(yest.toISOString())) return '昨天'
  const sameYear = d.getFullYear() === today.getFullYear()
  const mm = d.getMonth() + 1
  const dd = d.getDate()
  return sameYear ? `${mm}月${dd}日` : `${d.getFullYear()}年${mm}月${dd}日`
}

/**
 * 时间戳只显示到「分」，且**同一分钟内不重复显示**
 *
 * <p>小红书的做法：每条气泡旁显示 HH:mm，但连着发的几条只在最后一条显示。
 * 屏幕上全是 `14:23` 对读的人没有任何信息量。
 */
function timeLabel(m: MessageVO, prev?: MessageVO): string {
  const d = new Date(m.createTime)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (prev && new Date(prev.createTime).getMinutes() === d.getMinutes()
    && new Date(prev.createTime).getHours() === d.getHours()) {
    return ''
  }
  return `${hh}:${mm}`
}

const rows = computed<ChatRow[]>(() => {
  const out: ChatRow[] = []
  let lastKey = ''
  let prev: MessageVO | undefined
  for (const m of list.value) {
    const k = dayKey(m.createTime)
    if (k !== lastKey) {
      out.push({ kind: 'date', key: 'd-' + m.id, label: dateLabel(m.createTime) })
      lastKey = k
      prev = undefined
    }
    // ⚠️ `time` 挂在**行**上而不是塞回 msg：给 MessageVO 加一个
    // `__time` 会让它看起来像后端字段，将来有人拿它当接口契约去写文档。
    // 它是纯渲染派生量，只在这一行里活。
    out.push({ kind: 'msg', key: m.id, msg: m, time: timeLabel(m, prev) })
    prev = m
  }
  return out
})

async function loadPeer() {
  try {
    const card = await getUserFollowStatus(peerId.value)
    peerName.value = card.nickname
    peerAvatar.value = card.avatar
  } catch {
    // 拿不到昵称就用默认（「对方」），不要让整页崩掉
  }
}

onMounted(async () => {
  // ⚠️ 先等 userStore：气泡左右靠 myId 判断，userInfo 没到位时
  // 所有气泡都会渲染成「对方的」（mine() 返回 false），
  // 页面看上去只是左右颠倒，一闪而过很难归因
  await userStore.loadProfile().catch(() => {})
  await Promise.all([load(), loadPeer()])
  timer = setInterval(pollNew, POLL_MS)
  scroller.value?.addEventListener('scroll', onScroll, { passive: true })
})

function onScroll() {
  const el = scroller.value
  if (el && el.scrollTop < 40) void loadMore()
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  scroller.value?.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <main class="page chat">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">
        <van-icon name="arrow-left" />
      </button>
      <!-- 对方昵称是**导航目标**（点去看 TA 的主页），所以是 RouterLink -->
      <RouterLink class="peer" :to="{ name: 'user', params: { id: peerId } }" data-test="message-peer">
        <img
          class="avatar"
          :src="peerAvatar || MASCOT"
          :alt="`${peerName} 的头像`"
          width="28"
          height="28"
        />
        <span class="name">{{ peerName }}</span>
      </RouterLink>
      <RouterLink class="entry" :to="{ name: 'message-list' }" aria-label="全部私信" data-test="message-to-list">
        <van-icon name="chat-o" />
      </RouterLink>
    </header>

    <div ref="scroller"
      class="scroller"
      data-test="message-scroller">
      <p v-if="loading" class="hint" data-test="message-loading">加载中…</p>
      <p v-else-if="error" class="hint err" role="alert">{{ error }}</p>
      <p v-else-if="!list.length" class="hint" data-test="message-empty">
        还没有消息，打个招呼吧。
      </p>

      <!--
        ⚠️ 「加载更早」与消息列表**不是互斥分支**：它们是上下两个东西。
        第一版写成 `v-if="hasMore"` + `v-else-if="list.length"`，
        结果只要还有更多历史，整屏消息就一条都不渲染 ——
        而按钮照常显示，页面看上去是「加载中」的样子。
        症状是聊天页只剩一个按钮，**与「消息没加载出来」完全一样**，
        极难归因。两条都必须独立成立。
      -->
      <div v-if="hasMore" class="more-wrap" data-test="message-more">
        <button
          type="button"
          class="more"
          :disabled="loadingMore"
          data-test="message-load-more"
          @click="loadMore"
        >{{ loadingMore ? '加载中…' : '加载更早的消息' }}</button>
      </div>

      <ul v-if="list.length" class="bubbles">
        <template v-for="r in rows" :key="r.key">
          <!-- 日期分隔线：只在跨天处出现，不是每条都带 -->
          <li v-if="r.kind === 'date'" class="dayline" data-test="message-dayline">
            {{ r.label }}
          </li>

          <li
            v-else
            class="row"
            :class="mine(r.msg) ? 'me' : 'peer'"
            :data-msg-anchor="r.msg.id"
            :data-test="mine(r.msg) ? 'message-row-me' : 'message-row-peer'"
          >
            <!--
                两侧都显示头像：**自己这侧是我的头像**（真实 IM 就是这样 ——
                微信/QQ 自己发的消息右边挂的是自己的脸），不是占位、也不是对方的脸。
                2026-10-17 的 P35 把它做成了「自己这侧恒为灰色空圆」，理由是
                「怕显示成对方的头像」—— 那个担心是对的（v-if 只判 peerAvatar
                确实会让我的气泡旁出现对方的脸），但解法错了：
                应该取**我的** avatar，而不是两边都不显示。
                用户反馈「还是看不到两边的头像」正是这一点。

                `avatarOf()` 内部用 `|| MASCOT` 兜底，所以这里**不需要 v-if**：
                没有头像时也有图（吉祥物），`src=""` 结构上不可能发生。
              -->
            <img
              class="avatar"
              :src="avatarOf(r.msg)"
              :alt="altOf(r.msg)"
              width="34"
              height="34"
              data-test="message-avatar"
            />

            <div class="col">
              <!-- 图片消息：缩略图，不进气泡框（P32）
              --
              ⚠️ **刻意不加 loading="lazy"**：聊天页一屏只有十几条图，懒加载省不下什么，
              但它会让**刚好在视口底边那张图**的 decode() 一直不 resolve ——
              表现是「最后一张图永远转圈 / 量到 naturalWidth=0」，
              而真因（懒加载 + 边界）与症状隔了两层（AGENTS P25 在轮播上记过同一个坑）。
            -->
              <button
                v-if="r.msg.type === 2 && r.msg.imageUrl"
                type="button"
                class="thumb"
                data-test="message-image"
                :aria-label="'查看图片 ' + (r.msg.content || '图片消息')"
                @click="previewUrl = r.msg.imageUrl!"
              >
                <img :src="r.msg.imageUrl" alt="图片消息">
              </button>
              <div v-else class="bub">
                {{ r.msg.content }}
              </div>
              <time v-if="r.time" class="stamp" data-test="message-time">
                {{ r.time }}
              </time>
            </div>
          </li>
        </template>
      </ul>

      <!-- P31：发送失败的气泡留在原地，标红 + 可重发（而不是弹 toast 就消失） -->
      <ul v-if="failed.length" class="bubbles" data-test="message-failed">
        <li
          v-for="f in failed"
          :key="f.key"
          class="row me"
          data-test="message-failed-row"
        >
          <img class="avatar" :src="myAvatar" :alt="myName" width="34" height="34" data-test="message-avatar" />
          <div class="col">
            <!-- 失败重发也要能重发图片 -->
            <button
              v-if="f.imageUrl"
              type="button"
              class="thumb"
              data-test="message-failed-image"
              :aria-label="'查看失败的图片'"
              @click="previewUrl = f.imageUrl!"
            >
              <img :src="f.imageUrl" alt="图片消息">
            </button>
            <div v-else class="bub bad" data-test="message-failed-bubble">{{ f.content }}</div>
            <div class="retry-row">
              <span class="why" data-test="message-failed-reason">{{ f.error }}</span>
              <button
                type="button"
                class="retry"
                data-test="message-retry"
                :disabled="sending"
                @click="retryFailed(f)"
              >重新发送</button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <form class="composer" data-test="message-composer" @submit.prevent="send">
      <label class="sr-only" for="msg-input">消息内容</label>
      <textarea
        id="msg-input"
        v-model="draft"
        class="input"
        data-test="message-input"
        rows="1"
        :maxlength="MAX_LEN"
        placeholder="说点什么…"
        autocomplete="off"
        @keydown.enter.exact.prevent="send"
        @keydown.enter.shift.stop
      />
      <!-- 图片按钮：与表情开关同排（P32） -->
      <button
        type="button"
        class="icon-btn"
        data-test="message-image-pick"
        :disabled="uploading || sending"
        aria-label="发送图片"
        title="发送图片"
        @click="openPicker"
      >
        <van-icon name="photo-o" />
      </button>
      <!--
        ⚠️ input 必须放在 form **外面**：放在里面时选完文件会触发表单提交
        （input 的 change 在某些浏览器里会带着 form 一起 submit），
        症状是「选了图结果消息也发出去了」。
      -->
      <input
        ref="pickRef"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        class="file"
        data-test="message-file"
        @change="onPick"
      >
      <!-- 表情开关：切换动作 → button（aria-expanded 而非 aria-selected） -->
      <button
        type="button"
        class="icon-btn"
        data-test="message-emoji-toggle"
        :aria-expanded="emojiOpen"
        aria-label="表情"
        title="表情"
        @click="emojiOpen = !emojiOpen"
      >
        <van-icon name="smile-o" />
      </button>
      <!--
        发送是**动作**不是导航 → button 而不是链接。
        disabled 在请求在飞时就置上：连点两次会发两条，私信里这个代价很高
        （对方会看到两条一样的「在吗」）。
      -->
      <button
        class="send"
        type="submit"
        data-test="message-send"
        :disabled="!draft.trim() || sending"
      >
        发送
      </button>
    </form>

    <EmojiPanel v-if="emojiOpen" @pick="insertEmoji" />

    <!-- 大图预览（P32）：点缩略图放大，点任意处关闭 -->
    <div
      v-if="previewUrl"
      class="lightbox"
      data-test="message-lightbox"
      role="dialog"
      aria-label="图片预览"
      @click="previewUrl = null"
    >
      <img :src="previewUrl" alt="图片预览" data-test="message-lightbox-img">
    </div>
  </main>
</template>

<style scoped>
/* 聊天页要占满整屏：消息区自己滚，输入框吸底 */
.chat {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-height: 100dvh;
  overflow: hidden;
  padding-bottom: 0;
}

/* ⚠️ 桌面（≥1024px）必须减掉 SiteNav 的高度。
   SiteNav 是 `position: sticky`，**仍然占布局空间**，所以上面那行
   `height: 100dvh` 会让「顶栏 + 聊天页 100vh」正好多出一个顶栏的高度：
   文档多出一条纵向滚动条，而输入框因为在 flex 列的末尾，
   **底部落在视口之外** —— 症状是「聊天页底部看不见输入框」，
   而真因在两屏之外的 `.chat` 高度上。
   <1024px 时 SiteNav 是 display:none，不占空间，所以不能无条件减。

   ⚠️ **min-height 必须一起压掉**：全局 `.page { min-height: 100% }` 会兜住，
   而 CSS 里 **min-height 优先于 max-height** —— 只写 max-height 时实测
   `max-height: 998px` 明明生效了，`height` 却还是 1063px，
   症状是「我明明改了高度却没反应」。
   （本轮第一版就只写了 height/max-height，被这条静默吃掉。） */
@media (min-width: 1024px) {
  .chat {
    height: calc(100dvh - var(--xk-sitenav-h));
    max-height: calc(100dvh - var(--xk-sitenav-h));
    min-height: calc(100dvh - var(--xk-sitenav-h));
  }
}

.scroller {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--xk-space-4) var(--xk-card-pad);
}

.bubbles { list-style: none; margin: 0; padding: 0; }

/* 日期分隔线：居中、灰、小 —— 它是**分隔**，不是内容 */
.dayline {
  list-style: none;
  text-align: center;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
  margin: var(--xk-space-4) 0 var(--xk-space-3);
}

/* 一行 = 头像 + （气泡 + 时间戳） */
.row {
  list-style: none;
  display: flex;
  align-items: flex-start;
  gap: var(--xk-space-2);
  margin-bottom: var(--xk-space-3);
}
.row.me { flex-direction: row-reverse; }

.avatar {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--xk-surface-2);
}

/* ⚠️ 这里原本有一段 `.avatar-ghost { flex:0 0 auto; width:34px; height:34px }`，
   已删除 —— 它是 P35「自己这侧用灰色空圆占位」的配套样式。现在两侧都用
   `<img class="avatar">`，`.avatar` 自己已经声明了 flex/size，
   留着就是一条死规则。

   顺带记一句 P35 的教训（方向相反的同一个病）：那次是**模板删了、CSS 没删**，
   残留的 `.peer { display:inline-flex }` 把整个消息列表布局弄坏。
   这次是**改设计后忘了删配套 CSS**。两种都会静默留着，
   所以「改完要回头看一眼这个选择器还有没有宿主」。 */

.col {
  display: flex;
  flex-direction: column;
  gap: var(--xk-space-1);
  /* ⚠️ min-width:0：flex 子项默认 min-content，长消息会把这一列撑出容器 */
  min-width: 0;
  max-width: 78%;
}
.row.me .col { align-items: flex-end; }

.bub {
  padding: var(--xk-space-3) var(--xk-space-4);
  border-radius: 16px;
  font-size: var(--xk-fs-16);
  line-height: 1.6;
  /* 长链接/长词要能断行，否则一条长消息会把气泡撑满整屏宽 */
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.row.peer .bub {
  background: var(--xk-surface-2);
  border: 1px solid var(--xk-stroke);
  border-bottom-left-radius: 4px;
}
.row.me .bub {
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  border-bottom-right-radius: 4px;
}

/* 发送失败：标红 + 虚线边，与成功消息**形状明显不同**
   —— 虚线是关键，浅红底在琥珀气泡旁边几乎看不出来 */
.bub.bad {
  background: transparent;
  color: var(--xk-text-3);
  border: 1px dashed var(--xk-danger);
}

/* ---------- P32 图片消息 ---------- */

/* 缩略图：方形圆角，不进气泡框 */
.thumb {
  display: block;
  border: 0;
  padding: 0;
  background: none;
  cursor: pointer;
  border-radius: var(--xk-radius-md, 10px);
  overflow: hidden;
  line-height: 0;
  /* 缩略图本体就是点击目标，给够热区（P13） */
  min-width: 120px;
  min-height: 120px;
}
.thumb img {
  display: block;
  width: 160px;
  height: 160px;
  /* ⚠️ 必须是 contain，不能是 cover。
     160×160 的方框里用 cover 会把 461×367 的截图裁到只剩中间一块，
     430×900 的竖图更只剩一条 —— 收件人根本看不出对方发的是什么，
     而「看不清对方发了什么」在聊天里比「图不好看」严重得多。
     contain 保持方框（网格不散）又能看全，空白处露出 .thumb 的底色。 */
  object-fit: contain;
  /* 限定最大宽高，竖图不会被撑成一整屏 */
  max-width: 100%;
  background: var(--xk-surface-2);
}

/* file input 隐藏但**仍可被脚本点击**（不能用 display:none，
   那样 click() 在部分浏览器上不触发） */
.file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* 大图预览：全屏黑底，点任意处关闭 */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--xk-space-4);
  cursor: zoom-out;
}
.lightbox img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--xk-radius-sm, 4px);
}

.retry-row {
  display: flex;
  align-items: center;
  gap: var(--xk-space-2);
}
.why { font-size: var(--xk-fs-12); color: var(--xk-danger); }
.retry {
  font-size: var(--xk-fs-12);
  color: var(--xk-amber-text);
  background: none;
  border: 0;
  cursor: pointer;
  padding: 0;
  min-height: 28px;
}
.retry:disabled { opacity: 0.5; cursor: default; }

.stamp {
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
  font-variant-numeric: tabular-nums;
  padding: 0 var(--xk-space-1);
}

.more-wrap { text-align: center; padding: var(--xk-space-3) 0; }
.more {
  font-size: var(--xk-fs-13);
  color: var(--xk-text-2);
  background: var(--xk-surface-2);
  border: 1px solid var(--xk-stroke);
  border-radius: 999px;
  padding: var(--xk-space-2) var(--xk-space-4);
  min-height: 40px;
  cursor: pointer;
}
.more:disabled { opacity: 0.6; cursor: default; }

.composer {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: var(--xk-space-2);
  padding: var(--xk-space-3) var(--xk-card-pad);
  padding-bottom: calc(var(--xk-space-3) + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--xk-stroke);
  background: var(--xk-surface-1);
}

/* 表情开关：与发送键同高，热区 ≥40px（P13） */
.icon-btn {
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 44px;
  align-self: flex-end;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: 22px;
  cursor: pointer;
  border-radius: var(--xk-radius-sm);
  -webkit-tap-highlight-color: transparent;
}
.icon-btn:active { background: var(--xk-surface-2); }

@media (prefers-reduced-motion: reduce) {
  .icon-btn { transition: none; }
}

@media (min-width: 1024px) {
  /* 桌面消息区不要无限拉宽 —— 气泡 78% 的上限靠 .col 承担，
     这里只把整列收进可读宽度内 */
  .scroller { max-width: 760px; margin: 0 auto; width: 100%; }
  .composer { max-width: 760px; margin: 0 auto; width: 100%; }
}

@media (max-width: 1023px) {
  /* 表情面板占 236px；不加这个 page 会多出等高的死空白（与 P28 的
     --bar-h 同源：面板出现时输入框被推上去，但要给 TabBar 让位） */
  .chat { padding-bottom: 0; }
}

/* ⚠️ flex 内 textarea 必须 min-width:0 —— 否则 placeholder 一长
   就把发送按钮挤出容器（SiteNav 搜索框前科，同一个坑第三次） */
.input {
  flex: 1 1 auto;
  min-width: 0;
  /* 16px：iOS 聚焦时会自动缩放整页（WebKit 对 <16px 的输入框行为） */
  font-size: 16px;
  line-height: 1.5;
  padding: var(--xk-space-3);
  border: 1px solid var(--xk-stroke);
  border-radius: 18px;
  background: var(--xk-surface-2);
  color: var(--xk-text);
  resize: none;
  max-height: 140px;
  field-sizing: content;
}

.send {
  flex: none;
  min-width: 56px;
  min-height: 44px;
  padding: 0 var(--xk-space-3);
  border: 0;
  border-radius: 22px;
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font-size: var(--xk-fs-15);
  font-weight: 600;
}

.send:disabled { opacity: 0.45; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ⚠️ 这里原本有一整段 `.peer { display: inline-flex; color: inherit;
   text-decoration: none }` + `.peer .avatar` + `.peer .name`，已删除。
   那是 P22 老版「聊天页头部显示对方资料卡」布局留下的样式，P31 重做
   header（改成 `<RouterLink class="peer-link">`）时删了模板、没删样式。

   删不掉它的后果不是"多几行废代码"，而是**把整个聊天列表布局弄坏**：
   `.peer` 既是那段死规则的宿主，又同时是消息行 `:class` 里的类名
   （`mine(r.msg) ? 'me' : 'peer'`）。于是每一条**对方**消息的 `<li class="row">`
   都命中 `display: inline-flex`，`<li>` 从块级变成行内元素 → 消息横向流式排布、
   挤在同一行。**自己这一侧不带 peer 类，所以发送方看起来完全正常** ——
   这正是它能一路逃过 674 条 CDP 断言的原因。

   教训：重做布局时，「删模板」与「删对应 CSS」必须当成同一件事做。
   残留选择器不会报错、不会警告，只在它碰巧同名时静默改变别人的布局。 */


.entry {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: inherit;
}
</style>