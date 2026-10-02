<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BizError } from '@/api/request'
import { searchNotes } from '@/api/search'
import type { NoteListItemVO } from '@/api/types'

const route = useRoute()
const router = useRouter()

function keywordFromRoute(): string {
  const k = route.query.keyword
  return typeof k === 'string' ? k.trim() : ''
}

const keyword = ref(keywordFromRoute())
const results = ref<NoteListItemVO[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref('')

async function load(reset = true) {
  const kw = keyword.value.trim()
  if (!kw) return
  loading.value = true
  if (reset) page.value = 1
  else page.value += 1
  try {
    const data = await searchNotes(kw, page.value, 20)
    results.value = reset ? data.list : [...results.value, ...data.list]
    total.value = data.total
  } catch (e) {
    error.value = e instanceof BizError ? e.message : '搜索失败，请稍后重试'
    if (reset) results.value = []
  } finally {
    loading.value = false
  }
}

function submit() {
  const kw = keyword.value.trim()
  if (!kw) return
  // 关键词没变时路由不变，watch 不会触发，直接手动搜
  if (kw === keywordFromRoute()) {
    void load(true)
  } else {
    void router.replace({ name: 'search', query: kw ? { keyword: kw } : undefined })
  }
}

watch(
  () => route.query.keyword,
  (k) => {
    keyword.value = typeof k === 'string' ? k.trim() : ''
    void load(true)
  },
)

// 初进页面若带 ?keyword= 参数，直接开搜（watch 首次挂载不触发）
onMounted(() => {
  if (keywordFromRoute()) void load(true)
})

// 回车再点提交；点击卡片看详情，作者名进作者主页
</script>

<template>
  <main class="page">
    <header class="top">
      <span class="brand">搜索</span>
      <RouterLink class="back" to="/" data-test="search-back">← 返回首页</RouterLink>
    </header>

    <form class="search-row" role="search" data-test="search-form" @submit.prevent="submit">
      <input
        v-model="keyword"
        class="input"
        type="search"
        placeholder="搜笔记标题 / 正文…"
        aria-label="搜索笔记"
        data-test="search-input"
      />
      <button class="xk-btn go" type="submit" data-test="search-submit">搜索</button>
    </form>

    <section class="card xk-card xk-card--flat results" data-test="search-results">
      <p v-if="loading && !results.length" class="hint" data-test="search-loading">搜索中…</p>
      <p v-else-if="error" class="hint err" data-test="search-error">{{ error }}</p>
      <p v-else-if="!results.length" class="hint" data-test="search-empty">
        输入关键词，找找小哭猫的伙伴们发了什么
      </p>

      <ul v-else class="items">
        <li v-for="item in results" :key="item.id" class="item" data-test="search-item">
          <RouterLink class="main" :to="`/note/${item.id}`">
            <img class="cover" :src="item.cover ?? '/mascot/m02.webp'" alt="" loading="lazy" />
            <div class="body">
              <p class="title" data-test="search-title">{{ item.title }}</p>
              <p class="meta">
                ♥ {{ item.likeCount }} · ★ {{ item.collectCount }} · 评论
                {{ item.commentCount }}
              </p>
            </div>
          </RouterLink>

          <div class="who-line">
            <RouterLink class="author" :to="`/user/${item.authorId}`" data-test="search-author">
              {{ item.authorNickname }}
            </RouterLink>
          </div>
        </li>
      </ul>

      <button
        v-if="results.length && results.length < total"
        class="more xk-btn xk-btn--ghost"
        type="button"
        :disabled="loading"
        data-test="search-more"
        @click="load(false)"
      >
        {{ loading ? '加载中…' : `加载更多（${results.length}/${total}）` }}
      </button>
    </section>
  </main>
</template>

<style scoped>
/* .page 骨架统一在 main.css，这里重复写会用 0,2,0 特异性压掉全局断点 */

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: var(--xk-fs-15);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--xk-text-2);
}

.back {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  padding: 0 var(--xk-space-2);
  border: 0;
  background: none;
  color: var(--xk-amber);
  font-size: var(--xk-fs-13);
  cursor: pointer;
}

.search-row {
  display: flex;
  gap: 10px;
}

.input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text);
  font-size: var(--xk-fs-16);
}

.input:focus {
  outline: none;
  border-color: var(--xk-amber);
}

/* width:auto 见 SiteNav .go 的说明：.xk-btn 的 width:100% 会撑满整行并溢出 */
.go {
  width: auto;
  flex-shrink: 0;
  height: 42px;
  padding: 0 20px;
}

.results {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint {
  margin: 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
  line-height: 1.6;
}

.hint.err {
  color: var(--xk-danger);
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
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
  font-size: var(--xk-fs-15);
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
  font-size: var(--xk-fs-12);
}

.who-line {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 10px;
}

.author {
  padding: 0;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  cursor: pointer;
}

.more {
  align-self: center;
  padding: 8px 18px;
  font-size: var(--xk-fs-13);
}

/* 桌面端：搜索结果改三列瀑布（小红书搜索页的做法） */
@media (min-width: 1024px) {
  .search-row {
    max-width: 640px;
  }

  .items {
    display: block;
    columns: 3;
    column-gap: 16px;
  }

  .item,
  .item:first-child {
    break-inside: avoid;
    margin: 0 0 16px;
    padding: 0;
    border: var(--xk-stroke-w) solid var(--xk-stroke);
    border-radius: var(--xk-radius-blob);
    background: var(--xk-surface);
    box-shadow: var(--xk-shadow-hard-sm);
    overflow: hidden;
    transition: transform 0.12s ease;
  }

  .item:hover {
    transform: translate(-2px, -2px);
  }

  .main {
    flex-direction: column;
    gap: 0;
  }

  .cover {
    width: 100%;
    height: auto;
    aspect-ratio: 3 / 4;
    border-radius: 0;
  }

  .body {
    padding: 12px 12px 0;
  }

  .who-line {
    padding: 0 12px 12px;
  }
}

.author:hover {
  color: var(--xk-amber);
}
</style>