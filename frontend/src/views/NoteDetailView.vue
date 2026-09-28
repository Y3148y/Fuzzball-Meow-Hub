<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getNoteDetail } from '@/api/note'
import { BizError } from '@/api/request'
import { ErrorCode } from '@/api/types'
import type { NoteVO } from '@/api/types'

const route = useRoute()
const router = useRouter()

const note = ref<NoteVO | null>(null)
const loading = ref(true)
const errorMsg = ref('')
/** 404 与「已下架」分开提示：前者是地址错了，后者是内容不可看 */
const notFound = ref(false)

async function load() {
  loading.value = true
  errorMsg.value = ''
  notFound.value = false
  try {
    // route.params 已是 string，不要 Number()：雪花 ID 会丢精度
    note.value = await getNoteDetail(String(route.params.id))
  } catch (e) {
    if (e instanceof BizError) {
      if (e.code === ErrorCode.NOTE_NOT_FOUND) {
        notFound.value = true
        errorMsg.value = '这篇笔记不存在或已被删除'
      } else if (e.code === ErrorCode.NOTE_STATUS_ILLEGAL) {
        errorMsg.value = e.message
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

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">笔记详情</span>
    </header>

    <p v-if="loading" class="hint">加载中…</p>

    <p v-else-if="errorMsg" class="hint err" data-test="note-detail-error">{{ errorMsg }}</p>

    <article v-else-if="note" class="card xk-card" data-test="note-detail">
      <h1 class="title" data-test="note-detail-title">{{ note.title }}</h1>

      <div class="who">
        <img class="avatar" src="/mascot/m02.webp" alt="" />
        <div class="names">
          <p class="nickname" data-test="note-detail-author">{{ note.authorNickname }}</p>
          <p class="time">{{ note.createTime.replace('T', ' ').slice(0, 16) }}</p>
        </div>
      </div>

      <p class="content" data-test="note-detail-content">{{ note.content }}</p>

      <ul v-if="note.images.length" class="grid" data-test="note-detail-images">
        <li v-for="src in note.images" :key="src">
          <img :src="src" :alt="note.title" loading="lazy" />
        </li>
      </ul>

      <dl class="stats">
        <div><dt>点赞</dt><dd>{{ note.likeCount }}</dd></div>
        <div><dt>收藏</dt><dd>{{ note.collectCount }}</dd></div>
        <div><dt>评论</dt><dd>{{ note.commentCount }}</dd></div>
      </dl>

      <p v-if="notFound" class="gone">内容已不可见</p>
    </article>
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
  gap: 10px;
}

.brand {
  font-size: 15px;
  font-weight: 700;
}

.back {
  border: 0;
  background: none;
  font-size: 26px;
  line-height: 1;
  color: var(--xk-text-2);
  cursor: pointer;
  padding: 0 4px;
}

.hint {
  margin: 0;
  padding: 40px 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: 14px;
}

.err {
  color: #e5484d;
}

.title {
  margin: 0 0 14px;
  font-size: 20px;
  line-height: 1.4;
  word-break: break-word;
}

.who {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.avatar {
  width: 34px;
  height: 34px;
  object-fit: contain;
}

.names {
  min-width: 0;
}

.nickname {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.time {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--xk-text-3);
}

.content {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.grid {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: var(--xk-radius-blob-sm);
  display: block;
  background: var(--xk-surface-2);
}

.stats {
  margin: 20px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.stats > div {
  padding: 9px 6px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  text-align: center;
}

.stats dt {
  font-size: 12px;
  color: var(--xk-text-3);
}

.stats dd {
  margin: 3px 0 0;
  font-size: 16px;
  font-weight: 700;
}

.gone {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--xk-text-3);
  text-align: center;
}
</style>
