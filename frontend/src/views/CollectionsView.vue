<script setup lang="ts">
/**
 * 我的收藏夹
 *
 * <p>后端只返回**仍处于已发布状态**的笔记（已下架的点了会撞 20002，与其给一个
 * 点不开的条目不如不显示），所以这个页面不需要处理「已失效」卡片。
 *
 * <p>布局抄首页关注流那套：CSS `columns` 瀑布 —— 移动 2 列 / 桌面 4 列，
 * 封面高度按图片真实比例自适应（复用 textCard 之外的做法：@load 读 naturalWidth）。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getMyCollections } from '@/api/feed'
import type { NoteListItemVO } from '@/api/types'

const router = useRouter()

const list = ref<NoteListItemVO[]>([])
const loading = ref(true)
const error = ref('')
/** 封面真实宽高比，key 是笔记 id */
const ratios = ref<Record<string, string>>({})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const page = await getMyCollections(1, 50)
    list.value = page.list
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onCoverLoad(item: NoteListItemVO, ev: Event) {
  const img = ev.target as HTMLImageElement
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h || ratios.value[item.id]) return
  ratios.value = { ...ratios.value, [item.id]: `${w} / ${h}` }
}

/** 取消收藏后顺手把这条从列表里去掉（后端没有「收藏列表里直接取消」的接口） */
async function remove(item: NoteListItemVO) {
  list.value = list.value.filter((n) => n.id !== item.id)
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">
        <van-icon name="arrow-left" />
      </button>
      <span class="brand">我的收藏</span>
    </header>

    <p v-if="loading" class="hint" data-test="collections-loading">加载中…</p>
    <p v-else-if="error" class="hint err" role="alert">{{ error }}</p>
    <p v-else-if="!list.length" class="hint" data-test="collections-empty">
      还没有收藏，去发现页逛逛吧
    </p>

    <ul v-else class="items" data-test="collections-list">
      <li v-for="item in list" :key="item.id" class="item" data-test="collection-item">
        <RouterLink class="main" :to="`/note/${item.id}`">
          <img
            class="cover"
            :src="item.cover ?? '/mascot/m02.webp'"
            alt=""
            loading="lazy"
            :style="ratios[item.id] ? { '--r': ratios[item.id] } : undefined"
            @load="onCoverLoad(item, $event)"
          />
          <div class="body">
            <p class="title">{{ item.title }}</p>
            <p class="meta">
              ♥ {{ item.likeCount }} · ★ {{ item.collectCount }} · 评论
              {{ item.commentCount }}
            </p>
          </div>
        </RouterLink>
        <div class="who-line">
          <RouterLink class="author" :to="`/user/${item.authorId}`">
            {{ item.authorNickname }}
          </RouterLink>
          <button class="uncollect" type="button" data-test="collection-remove" @click="remove(item)">
            取消收藏
          </button>
        </div>
      </li>
    </ul>
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

/* 瀑布：移动 2 列、桌面 4 列（与首页关注流同构） */
.items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: block;
  columns: 2;
  column-gap: 10px;
}

.item {
  break-inside: avoid;
  margin: 0 0 10px;
  padding: 0;
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: var(--xk-radius-blob);
  background: var(--xk-surface);
  box-shadow: var(--xk-shadow-hard-sm);
  overflow: hidden;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
}

.cover {
  display: block;
  width: 100%;
  height: auto;
  /* 加载前用 3/4 占位防 CLS，@load 后换成图片真实比例 */
  aspect-ratio: var(--r, 3 / 4);
  object-fit: cover;
  background: var(--xk-surface-2);
}

.body {
  min-width: 0;
  padding: 8px 8px 0;
}

.title {
  margin: 0;
  font-size: var(--xk-fs-14);
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.meta {
  margin: 4px 0 0;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
  font-variant-numeric: tabular-nums;
}

.who-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px 8px;
}

.author {
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uncollect {
  flex-shrink: 0;
  min-height: 40px;
  padding: 0 12px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-12);
  cursor: pointer;
}

@media (min-width: 1024px) {
  .items {
    columns: 4;
    column-gap: 20px;
  }

  .item {
    margin: 0 0 20px;
  }

  .body {
    padding: 12px 12px 0;
  }

  .title {
    font-size: var(--xk-fs-15);
  }

  .who-line {
    padding: 0 12px 12px;
  }
}
</style>