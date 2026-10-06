<script setup lang="ts">
/**
 * 通知中心
 *
 * <p>列表项按 `type` 决定跳哪里：
 * <ul>
 *   <li>1赞笔记 / 2评论 / 5回复 → 跳笔记详情（5 的 targetId 是父评论，落地后滚到评论区）</li>
 *   <li>3赞评论 → 跳笔记详情（评论区）</li>
 *   <li>4关注 → 跳被关注者主页（targetId 就是 TA 的 userId）</li>
 * </ul>
 * 点开即标已读：先标后跳，标失败也照跳（角标刷新失败不该拦住用户看内容）。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listNotifications, markAllRead, markRead } from '@/api/notification'
import type { NotificationVO } from '@/api/types'
import { formatDateTime } from '@/utils/datetime'

const router = useRouter()

const list = ref<NotificationVO[]>([])
const loading = ref(true)
const error = ref('')
const onlyUnread = ref(false)
const total = ref(0)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const page = await listNotifications(1, 50, onlyUnread.value)
    list.value = page.list
    total.value = page.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function open(n: NotificationVO) {
  if (n.isRead === 0) {
    // 先本地改，标已读的响应回来再由铃铛刷新角标
    n.isRead = 1
    try {
      await markRead(n.id)
    } catch {
      // 标失败不打断跳转
    }
  }
  // 关注类（type=4）的 targetId 是被关注者 userId，其余都是笔记
  if (n.type === 4) {
    void router.push({ name: 'user', params: { id: String(n.targetId) } })
    return
  }
  if (n.noteId) {
    void router.push({ name: 'note-detail', params: { id: String(n.noteId) } })
    return
  }
  // 没有 noteId 的极端情况（笔记被删且没清理通知）：回到首页而不是死链
  void router.push({ name: 'home' })
}

async function readAll() {
  try {
    await markAllRead()
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败'
  }
}

function toggleUnread() {
  onlyUnread.value = !onlyUnread.value
  void load()
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">
        <van-icon name="arrow-left" />
      </button>
      <span class="brand">通知</span>
      <button class="read-all" type="button" data-test="notification-read-all" @click="readAll">
        全部已读
      </button>
    </header>

    <section class="bar">
      <button
        class="filter"
        :class="{ on: onlyUnread }"
        type="button"
        :aria-pressed="onlyUnread"
        data-test="notification-only-unread"
        @click="toggleUnread"
      >
        只看未读
      </button>
      <span class="count">{{ total }} 条</span>
    </section>

    <section class="card xk-card list" data-test="notification-list">
      <p v-if="loading" class="hint" data-test="notification-loading">加载中…</p>
      <p v-else-if="error" class="hint err" role="alert">{{ error }}</p>
      <p v-else-if="!list.length" class="hint" data-test="notification-empty">
        {{ onlyUnread ? '没有未读通知' : '还没有通知，去首页逛逛吧' }}
      </p>

      <ul v-else class="items">
        <li
          v-for="n in list"
          :key="n.id"
          class="item"
          :class="{ unread: n.isRead === 0 }"
          :data-test="n.isRead === 0 ? 'notification-item-unread' : 'notification-item'"
          :data-type="n.type"
        >
          <img class="avatar" :src="n.actorAvatar ?? '/mascot/m02.webp'" alt="" width="34" height="34" />
          <div class="body">
            <p class="line">
              <b class="who">{{ n.actorNickname }}</b>
              <span class="text">{{ n.typeText }}</span>
            </p>
            <p v-if="n.noteTitle" class="note">{{ n.noteTitle }}</p>
            <p v-if="n.content" class="quote">{{ n.content }}</p>
            <p class="time">{{ formatDateTime(n.createTime) }}</p>
          </div>
          <!-- 整行可点：按钮包住整条，屏幕阅读器也能当一个可读区域 -->
          <button class="hit" type="button" :aria-label="`${n.actorNickname}${n.typeText}`" @click="open(n)">
            <span class="sr">{{ n.typeText }}</span>
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.top {
  display: flex;
  align-items: center;
  gap: var(--xk-space-3);
}

.back {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-17);
  cursor: pointer;
}

.brand {
  flex: 1;
  font-size: var(--xk-fs-17);
  font-weight: 700;
}

.read-all {
  min-height: 40px;
  padding: 0 12px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  cursor: pointer;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--xk-space-3);
}

.filter {
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
  cursor: pointer;
}

.filter.on {
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font-weight: 700;
}

.count {
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
  font-variant-numeric: tabular-nums;
}

.list {
  display: flex;
  flex-direction: column;
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.item {
  position: relative;
  display: flex;
  gap: var(--xk-space-3);
  padding: 12px 0;
  border-top: var(--xk-stroke-w) solid var(--xk-border);
}

.item:first-child {
  border-top: 0;
}

.item.unread {
  background: var(--xk-surface-2);
  border-radius: var(--xk-radius-blob-sm);
  /* 未读底色要往内缩，不然圆角外侧还是白底，看着像贴了张纸 */
  padding-left: 8px;
  padding-right: 8px;
}

.avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  object-fit: contain;
}

.body {
  min-width: 0;
  flex: 1;
}

.line {
  margin: 0;
  font-size: var(--xk-fs-14);
  line-height: 1.5;
}

.who {
  margin-right: 4px;
  font-weight: 700;
}

.text {
  color: var(--xk-text-2);
}

.note {
  margin: 4px 0 0;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quote {
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-12);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item.unread .quote {
  background: var(--xk-surface);
}

.time {
  margin: 4px 0 0;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
  font-variant-numeric: tabular-nums;
}

/*
  整行点击区：透明覆盖在 .item 上。
  不用给 .item 绑 click —— 那会让头像/文字这些子元素各自成为可聚焦目标，
  键盘 Tab 会一行里跳三次。
*/
.hit {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>