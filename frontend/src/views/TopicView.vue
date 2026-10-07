<script setup lang="ts">
/**
 * 话题页（`/topic/:name`）
 *
 * <p>话题是小红书内容组织的骨架：搜索只能靠关键词撞上，话题页是「顺着兴趣往下钻」——
 * 看了这篇的人还能看到同一话题下的其它内容，这是搜索做不到的。
 *
 * <p>布局直接抄首页那套 CSS `columns` 瀑布（移动 2 列 / 桌面 4 列），
 * 卡片结构与 NoteListItemVO 一致，不另立一套样式。
 */
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { listTopicNotes } from '@/api/topic'
import type { NoteListItemVO } from '@/api/types'

const route = useRoute()

const notes = ref<NoteListItemVO[]>([])
const loading = ref(true)
const errorMsg = ref('')
/** 封面真实宽高比，key 是笔记 id */
const ratios = ref<Record<string, string>>({})
const topicName = ref('')

async function load() {
  loading.value = true
  errorMsg.value = ''
  ratios.value = {}
  // 路由参数里的名字已由 router 规则保证是中文/字母，这里再解一次
  const name = decodeURIComponent(String(route.params.name))
  topicName.value = name
  try {
    const page = await listTopicNotes(name, 1, 20)
    notes.value = page.list
  } catch (e) {
    // 后端对不存在的话题返回 70001，这里直接显示它给的文案
    errorMsg.value = e instanceof Error ? e.message : '加载失败，请稍后重试'
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

// 从一个话题点进另一个话题时组件不重新挂载，必须 watch
watch(() => route.params.name, load)
onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <span class="brand">#{{ topicName }}</span>
    </header>

    <p v-if="loading" class="hint" data-test="topic-loading">加载中…</p>
    <p v-else-if="errorMsg" class="hint err" role="alert" data-test="topic-error">{{ errorMsg }}</p>
    <p v-else-if="!notes.length" class="hint" data-test="topic-empty">
      这个话题下还没有笔记
    </p>

    <ul v-else class="items" data-test="topic-list">
      <li v-for="item in notes" :key="item.id" class="item" data-test="topic-item">
        <RouterLink class="main" :to="`/note/${item.id}`">
          <img
            class="cover"
            :src="item.cover ?? ''"
            :style="{ '--img-ratio': ratios[item.id] ?? '3 / 4' }"
            alt=""
            width="240"
            height="320"
            loading="lazy"
            @load="onCoverLoad(item, $event)"
          />
          <p class="title">{{ item.title }}</p>
        </RouterLink>
        <RouterLink class="author" :to="`/user/${item.authorId}`">
          <img class="avatar" src="/mascot/m02.webp" alt="" width="24" height="24" />
          <span class="nick">{{ item.authorNickname }}</span>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>

<style scoped>
/* .page 骨架在 main.css；这里不重复写 max-width，否则 0,2,0 的 scoped
   特异性会压掉全局断点（这条坑 P12-C 踩过两次） */
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0 10px;
}

.brand {
  font-size: var(--xk-fs-17);
  font-weight: 700;
  /* 话题名可能是很长的中文，截断比撑破顶栏好 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  margin: 40px 0 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
}

.hint.err {
  color: var(--xk-danger);
}

/* 瀑布：移动 2 列、桌面 4 列，与首页一致 */
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  columns: 2;
  column-gap: 12px;
}

.item {
  break-inside: avoid;
  margin: 0 0 12px;
}

.main {
  display: block;
  text-decoration: none;
  color: inherit;
}

.cover {
  display: block;
  width: 100%;
  aspect-ratio: var(--img-ratio, 3 / 4);
  object-fit: cover;
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: var(--xk-radius-blob);
  box-shadow: var(--xk-shadow-hard-sm);
}

.title {
  margin: 8px 0 0;
  font-size: var(--xk-fs-14);
  line-height: 1.5;
  color: var(--xk-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.author {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  text-decoration: none;
  color: var(--xk-text-2);
}

.avatar {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.nick {
  font-size: var(--xk-fs-12);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (min-width: 1024px) {
  .items {
    columns: 4;
    column-gap: 20px;
  }

  .item {
    margin-bottom: 20px;
  }
}
</style>