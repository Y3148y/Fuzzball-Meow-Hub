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
// 对方卡片用 follow 域的「一次往返拿全」端点（UserView 用的同一个），
// 不另开一个只返回昵称头像的新接口 —— 那会造出第二个形状相同的用户卡片
import { getUserFollowStatus } from '@/api/follow'
import { useMessageUnread } from '@/composables/useMessageUnread'
import { useUserStore } from '@/stores/user'
import type { MessageVO } from '@/api/types'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const peerId = computed(() => String(route.params.id ?? ''))
const myId = computed(() => userStore.userInfo?.id)

const peerName = ref('对方')
const peerAvatar = ref<string | null>(null)
const list = ref<MessageVO[]>([])
const loading = ref(true)
const sending = ref(false)
const error = ref('')
const draft = ref('')

const scroller = ref<HTMLElement | null>(null)
const MAX_LEN = 1000

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
    const page = await messageHistory(peerId.value, 1, 50)
    list.value = page.list
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
  sending.value = true
  try {
    const msg = await sendMessage(peerId.value, content)
    list.value.push(msg)
    draft.value = ''
    scrollToBottom(true)
  } catch (e) {
    // 50004（对方拉黑了我）在这里才有意义 —— 它是**发送时**才暴露的，
    // 后端刻意不在别处提示（P18 原则：不暴露对方的操作）
    showToast(e instanceof Error ? e.message : '发送失败')
  } finally {
    sending.value = false
  }
}

/** 轮询只追加**新**消息，不重排已有的 —— 否则用户正在看的那条会跳位 */
async function pollNew() {
  if (document.hidden || sending.value) return
  try {
    const page = await messageHistory(peerId.value, 1, 50)
    const known = new Set(list.value.map((m) => m.id))
    const fresh = page.list.filter((m) => !known.has(m.id))
    if (fresh.length) {
      const atBottom = isNearBottom()
      list.value.push(...fresh)
      if (atBottom) scrollToBottom(true)
      void markRead()
    }
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
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
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
          v-if="peerAvatar"
          class="avatar"
          :src="peerAvatar"
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

    <div ref="scroller" class="scroller" data-test="message-scroller">
      <p v-if="loading" class="hint" data-test="message-loading">加载中…</p>
      <p v-else-if="error" class="hint err" role="alert">{{ error }}</p>
      <p v-else-if="!list.length" class="hint" data-test="message-empty">
        还没有消息，打个招呼吧。
      </p>

      <ul v-else class="bubbles">
        <li
          v-for="m in list"
          :key="m.id"
          class="bubble"
          :class="mine(m) ? 'me' : 'peer'"
          :data-test="mine(m) ? 'message-bubble-me' : 'message-bubble-peer'"
        >
          {{ m.content }}
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
      />
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

.scroller {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--xk-space-4) var(--xk-card-pad);
}

.bubbles { list-style: none; margin: 0; padding: 0; }

.bubble {
  max-width: 78%;
  margin-bottom: var(--xk-space-3);
  padding: var(--xk-space-3) var(--xk-space-4);
  border-radius: 16px;
  font-size: var(--xk-fs-16);
  line-height: 1.6;
  /* 长链接/长词要能断行，否则一条长消息会把气泡撑满整屏宽 */
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.bubble.peer {
  margin-right: auto;
  background: var(--xk-surface-2);
  border: 1px solid var(--xk-stroke);
  border-bottom-left-radius: 4px;
}

.bubble.me {
  margin-left: auto;
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  border-bottom-right-radius: 4px;
}

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

.peer {
  display: inline-flex;
  align-items: center;
  gap: var(--xk-space-2);
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.peer .avatar { border-radius: 50%; object-fit: cover; flex: none; }

.peer .name {
  font-size: var(--xk-fs-16);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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