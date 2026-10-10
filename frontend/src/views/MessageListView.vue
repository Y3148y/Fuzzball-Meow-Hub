<script setup lang="ts">
/**
 * 私信会话列表
 *
 * <p>轮询而不是 WebSocket：每 15s 拉一次未读数，只在**角标**上体现新消息。
 * 刻意不在这里轮询整个会话列表 —— 那会让列表每 15s 重排一次，
 * 而用户正在读某一条时列表跳动比晚几秒看到新消息更让人烦躁。
 * 「进会话页才看到新消息」是刻意接受的代价。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listSessions } from '@/api/message'
import { useMessageUnread } from '@/composables/useMessageUnread'
import type { MessageSessionVO } from '@/api/types'
import { formatRelative } from '@/utils/datetime'

const router = useRouter()

const list = ref<MessageSessionVO[]>([])
const loading = ref(true)
const error = ref('')

const POLL_MS = 15_000
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = await listSessions()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  // 只轮询未读数。列表本身不轮询，理由见文件头注释。
  const unreadState = useMessageUnread()
  await unreadState.refresh()
  timer = setInterval(() => useMessageUnread().refresh(), POLL_MS)
})

onBeforeUnmount(() => {
  // ⚠️ 漏掉这一句就是「离开页面后仍在打接口」，连续进出几次就能把
  // 限流桶打满（而且症状是「进页面时报网络异常」，与真因隔得很远）
  if (timer) clearInterval(timer)
})
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">
        <van-icon name="arrow-left" />
      </button>
      <span class="brand">私信</span>
    </header>

    <section class="card xk-card list" data-test="session-list">
      <p v-if="loading" class="hint" data-test="session-loading">加载中…</p>
      <p v-else-if="error" class="hint err" role="alert">{{ error }}</p>
      <p v-else-if="!list.length" class="hint" data-test="session-empty">
        还没有私信。在别人的主页点「⋯」→「私信」就能开始聊。
      </p>

      <ul v-else class="items">
        <li
          v-for="s in list"
          :key="s.sessionId"
          class="item"
          :class="{ unread: s.unread > 0 }"
          :data-test="s.unread > 0 ? 'session-item-unread' : 'session-item'"
        >
          <!--
            点整行是**导航**（进会话页），所以用 RouterLink 而不是 button。
            ⚠️ 与头像分开成两个链接会重复渲染角色，语音助手会把同一行念两遍。
          -->
          <RouterLink
            class="row"
            data-test="session-row"
            :to="{ name: 'message', params: { id: String(s.peerId) } }"
          >
            <img
              class="avatar"
              :src="s.peerAvatar ?? '/mascot/m02.webp'"
              :alt="`${s.peerNickname} 的头像`"
              width="44"
              height="44"
            />
            <div class="body">
              <p class="line">
                <b class="who">{{ s.peerNickname }}</b>
                <time v-if="s.lastTime" class="time">{{ formatRelative(s.lastTime) }}</time>
              </p>
              <p class="preview">{{ s.lastMessage ?? '（还没有消息）' }}</p>
            </div>
            <span v-if="s.unread > 0" class="badge" :data-test="'session-unread-badge'">
              {{ s.unread > 99 ? '99+' : s.unread }}
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.list { padding: 0; }
.items { list-style: none; margin: 0; padding: 0; }

.item + .item { border-top: 1px solid var(--xk-stroke); }

.row {
  /* flex 内必须 min-width:0 —— 否则昵称长一点就把右侧角标挤出容器
     （SiteNav 搜索框前科，同一个坑踩过两次） */
  display: flex;
  align-items: center;
  gap: var(--xk-space-3);
  min-width: 0;
  padding: var(--xk-space-3) var(--xk-card-pad);
  color: inherit;
  text-decoration: none;
}

.avatar { flex: none; border-radius: 50%; object-fit: cover; }

.body { flex: 1 1 auto; min-width: 0; }

.line { display: flex; align-items: baseline; gap: var(--xk-space-2); }

.who {
  font-size: var(--xk-fs-16);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  margin-left: auto;
  flex: none;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-2);
}

.preview {
  margin-top: 2px;
  font-size: var(--xk-fs-14);
  color: var(--xk-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item.unread .preview { color: var(--xk-text); font-weight: 500; }

.badge {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font-size: var(--xk-fs-12);
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  text-align: center;
}
</style>