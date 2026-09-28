<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BizError } from '@/api/request'
import { followUser, getUserFollowStatus, unfollowUser } from '@/api/follow'
import { getUserNotes } from '@/api/feed'
import { ErrorCode } from '@/api/types'
import type { FollowUserVO, NoteListItemVO } from '@/api/types'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/** route.params 已是 string，不要 Number()：雪花 ID 会丢精度 */
const userId = String(route.params.id)

const author = ref<FollowUserVO | null>(null)
const notes = ref<NoteListItemVO[]>([])
const loading = ref(true)
const notFound = ref(false)
const errorMsg = ref('')
const following = ref(false)

const isSelf = computed(() => !!userStore.userInfo && userId === userStore.userInfo.id)

async function load() {
  loading.value = true
  notFound.value = false
  errorMsg.value = ''
  try {
    const [card, page] = await Promise.all([
      getUserFollowStatus(userId),
      getUserNotes(userId, 1, 20),
    ])
    author.value = card
    notes.value = page.list
  } catch (e) {
    if (e instanceof BizError) {
      if (e.code === ErrorCode.USER_NOT_FOUND) {
        notFound.value = true
        errorMsg.value = '用户不存在'
      } else if (e.code === ErrorCode.UNAUTHORIZED || e.code === ErrorCode.TOKEN_INVALID) {
        errorMsg.value = '登录已过期，请重新登录'
      } else {
        errorMsg.value = e.message
      }
    } else {
      errorMsg.value = '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

async function toggleFollow() {
  if (!author.value || following.value) return
  following.value = true
  try {
    const res = author.value.followed
      ? await unfollowUser(author.value.id)
      : await followUser(author.value.id)
    author.value.followed = res.followed
    void userStore.loadProfile().catch(() => {})
  } catch (e) {
    if (e instanceof BizError) {
      if (e.code === ErrorCode.ALREADY_FOLLOWED || e.code === ErrorCode.NOT_FOLLOWED) {
        await load()
        return
      }
    }
    throw e
  } finally {
    following.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">TA 的主页</span>
    </header>

    <p v-if="loading" class="hint" data-test="user-loading">加载中…</p>
    <p v-else-if="errorMsg" class="hint err" data-test="user-error">{{ errorMsg }}</p>

    <template v-else-if="author">
      <section class="card xk-card">
        <div class="who">
          <img class="avatar" src="/mascot/m02.webp" alt="" />
          <div class="names">
            <h1 class="nickname" data-test="user-nickname">{{ author.nickname }}</h1>
            <p class="username" data-test="user-username">@{{ author.username }}</p>
          </div>
          <button
            v-if="!isSelf"
            class="follow"
            :class="{ on: author.followed }"
            type="button"
            :disabled="following"
            data-test="user-follow"
            @click="toggleFollow"
          >
            {{ author.followed ? '已关注' : '关注' }}
          </button>
        </div>

        <p v-if="author.bio" class="bio" data-test="user-bio">{{ author.bio }}</p>

        <dl class="stats">
          <div class="stat">
            <dt>关注</dt>
            <dd data-test="user-follow-count">{{ author.followCount ?? 0 }}</dd>
          </div>
          <div class="stat">
            <dt>粉丝</dt>
            <dd data-test="user-fans-count">{{ author.fansCount ?? 0 }}</dd>
          </div>
          <div class="stat">
            <dt>获赞</dt>
            <dd data-test="user-like-count">{{ author.likeReceivedCount ?? 0 }}</dd>
          </div>
        </dl>
      </section>

      <section class="card xk-card xk-card--flat feed">
        <h2 class="feed-title">TA 的笔记</h2>
        <p v-if="!notes.length" class="hint" data-test="user-notes-empty">还没有发过笔记</p>
        <ul v-else class="items" data-test="user-notes">
          <li v-for="item in notes" :key="item.id" class="item" data-test="user-note">
            <button class="main" type="button" @click="router.push(`/note/${item.id}`)">
              <img class="cover" :src="item.cover ?? '/mascot/m02.webp'" alt="" loading="lazy" />
              <div class="body">
                <p class="title">{{ item.title }}</p>
                <p class="meta">
                  ♥ {{ item.likeCount }} · ★ {{ item.collectCount }} · 评论 {{ item.commentCount }}
                </p>
              </div>
            </button>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style scoped>
.page {
  min-height: 100%;
  padding: calc(16px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back {
  width: 30px;
  height: 30px;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0 0 2px;
}

.brand {
  font-size: 15px;
  font-weight: 700;
}

.card {
  padding: 18px;
}

.hint {
  margin: 40px 0 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: 13px;
}

.hint.err {
  color: var(--xk-danger);
}

.who {
  display: flex;
  align-items: center;
  gap: 14px;
}

.avatar {
  width: 62px;
  height: 62px;
  object-fit: contain;
  flex-shrink: 0;
}

.names {
  min-width: 0;
  flex: 1;
}

.nickname {
  margin: 0;
  font-size: 21px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.username {
  margin: 3px 0 0;
  color: var(--xk-text-3);
  font-size: 13px;
}

.follow {
  flex-shrink: 0;
  padding: 6px 16px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: 13px;
  cursor: pointer;
}

.follow.on {
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  border-color: transparent;
  font-weight: 700;
}

.follow:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.bio {
  margin: 14px 0 0;
  color: var(--xk-text-2);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 18px 0 0;
  padding: 0;
}

.stat {
  padding: 10px 6px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  text-align: center;
}

.stat dt {
  color: var(--xk-text-3);
  font-size: 12px;
}

.stat dd {
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 700;
}

.feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feed-title {
  margin: 0;
  font-size: 15px;
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.item {
  padding: 12px 0;
  border-top: var(--xk-stroke-w) solid var(--xk-border);
}

.item:first-child {
  border-top: 0;
}

.main {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.cover {
  width: 84px;
  height: 84px;
  object-fit: cover;
  border-radius: var(--xk-radius-blob-sm);
  flex-shrink: 0;
  background: var(--xk-surface-2);
}

.body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta {
  margin: 0;
  color: var(--xk-text-3);
  font-size: 12px;
}
</style>