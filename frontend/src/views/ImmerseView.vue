<script setup lang="ts">
/**
 * 竖屏沉浸流（P34）
 *
 * <p>一屏一张、上下滑切换 —— 小红书「发现」页的形态。
 *
 * <p>**为什么值得单独做一个页面而不是首页改版**：首页是「浏览与比较」的形态
 * （瀑布流、小图、扫视），沉浸流是「沉浸消费」的形态（一屏一张、大图、逐条读）。
 * 两种形态的手势、加载策略、信息密度都不同，塞进一个页面只能取折中值，
 * 结果是两边都不好用。
 *
 * <p>排序与发现流**刻意一致**（后端复用同一个 mapper）：用户在首页看到的内容
 * 与滑到的内容必须对得上，否则「首页有但滑不到」极难归因。
 *
 * <p>**核心实现是 CSS scroll-snap**，不是手势库：
 * ① 手势库要自己算惯性、自己处理中断，边界处最容易出错；
 * ② 原生滚动天然支持键盘（↑↓ / PageUp/PageDown）与读屏，
 *    而这两样是自实现手势最容易丢的（P14 那些可访问性整改的延续）。
 * 代价是<b>没法做「快速连滑」</b> —— 原生滚动会等动画结束才处理下一次，
 * 而这不是一个值得付代价去换的能力。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { immerseFeed } from '@/api/feed'
import type { ImmerseCardVO } from '@/api/types'

const router = useRouter()

const cards = ref<ImmerseCardVO[]>([])
const active = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(true)
const error = ref('')
const scroller = ref<HTMLElement | null>(null)

/** 一页 6 条：够滑一会儿，又不至于让首屏等太久 */
const PAGE_SIZE = 6

const current = computed<ImmerseCardVO | null>(() => cards.value[active.value] ?? null)

async function load(reset = false) {
  if (loading.value) return
  if (reset) {
    loading.value = true
    error.value = ''
    page.value = 1
    cards.value = []
    active.value = 0
  }
  try {
    const res = await immerseFeed(page.value, PAGE_SIZE)
    cards.value = reset ? res.list : cards.value.concat(res.list ?? [])
    hasMore.value = (res.list ?? []).length > 0 && cards.value.length < (res.total ?? 0)
    if (!cards.value.length && !error.value) error.value = '这里还没有内容'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || loading.value || !hasMore.value) return
  loadingMore.value = true
  page.value += 1
  await load(false)
}

/**
 * 滑到哪一张 —— 用 scrollTop 反推索引
 *
 * <p>⚠️ 不能用 IntersectionObserver 当**唯一**依据：它有 rootMargin 与阈值，
 * 快速连滑时会在两张之间「都认为可见」，而 snap 定位发生在滚动结束之后，
 * 两者到达的时刻不一致，于是计数器会跳。这里用滚动位置反推（scroll-snap
 * 保证位置与索引一一对应），Observer 只用来「快到了就预加载」。
 */
function onScroll() {
  const el = scroller.value
  if (!el) return
  const idx = Math.round(el.scrollTop / el.clientHeight)
  if (idx !== active.value && idx >= 0 && idx < cards.value.length) {
    active.value = idx
  }
  // 离底部还有 2 张就预加载 —— 一屏 1 张，2 张的余量足够覆盖一次网络往返
  if (idx >= cards.value.length - 3) void loadMore()
}

/** 卡内图片左右切（多图笔记） */
const imgIdx = ref<Record<string, number>>({})
function imgOf(c: ImmerseCardVO): number {
  return imgIdx.value[c.id] ?? 0
}
function shiftImg(c: ImmerseCardVO, d: number) {
  const n = c.images.length
  if (n < 2) return
  const next = (imgOf(c) + d + n) % n
  imgIdx.value = { ...imgIdx.value, [c.id]: next }
}

/** 当前这张是不是多图 —— 决定要不要画轮播指示器与左右切换点 */
const curImgs = computed(() => current.value?.images ?? [])

function goDetail() {
  if (current.value) void router.push(`/note/${current.value.id}`)
}

function back() {
  void router.back()
}

// 切卡片时把该卡的图轮播索引复位：否则从 3/5 滑走再滑回来还停在 3/5，
// 而用户滑回来通常是想从头看
watch(active, () => { imgIdx.value = { ...imgIdx.value } })

onMounted(() => {
  void load(true)
  scroller.value?.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  scroller.value?.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <main class="immerse" data-test="immerse-page">
    <header class="bar">
      <button class="icon" type="button" aria-label="返回" data-test="immerse-back" @click="back">
        <van-icon name="arrow-left" />
      </button>
      <span class="count" data-test="immerse-counter">
        {{ cards.length ? active + 1 : 0 }}<template v-if="hasMore"> / {{ cards.length }}+</template>
      </span>
    </header>

    <div ref="scroller" class="track" data-test="immerse-track">
      <p v-if="loading" class="hint" data-test="immerse-loading">加载中…</p>
      <p v-else-if="error" class="hint err" role="alert" data-test="immerse-error">
        {{ error }}
      </p>

      <section
        v-for="(c, i) in cards"
        v-else
        :key="c.id"
        class="slide"
        :class="{ on: i === active }"
        :data-test="'immerse-slide'"
        :data-slide-index="i"
      >
        <!-- 视频笔记：全屏播放；图文笔记：卡内轮播 -->
        <div v-if="c.type === 2 && c.videoUrl" class="media">
          <video :src="c.videoUrl" controls preload="metadata" playsinline class="video" />
        </div>
        <div v-else class="media">
          <img :src="c.images[imgOf(c)]" :alt="c.title" class="pic" data-test="immerse-pic">
          <div v-if="c.images.length > 1" class="strip" data-test="immerse-strip">
            <span
              v-for="(u, k) in c.images"
              :key="u"
              class="tick"
              :class="{ on: k === imgOf(c) }"
              :aria-current="k === imgOf(c) ? 'true' : undefined"
            />
          </div>
        </div>

        <div class="info">
          <h2 class="title" data-test="immerse-title">{{ c.title }}</h2>
          <p v-if="c.contentBrief" class="brief" data-test="immerse-brief">{{ c.contentBrief }}</p>

          <div class="who">
            <img v-if="c.authorAvatar" class="avatar" :src="c.authorAvatar" :alt="c.authorNickname"
                 width="32" height="32">
            <span v-else class="avatar ghost" aria-hidden="true" />
            <RouterLink class="nick" :to="'/user/' + c.authorId" data-test="immerse-author">
              {{ c.authorNickname }}
            </RouterLink>
            <span class="counts">
              <span class="num">{{ c.likeCount }}</span> 赞
              <span class="num">{{ c.commentCount }}</span> 评
            </span>
          </div>

          <button class="open" type="button" data-test="immerse-open" @click="goDetail">
            查看全文与评论
          </button>
        </div>
      </section>

      <p v-if="loadingMore && cards.length" class="more" data-test="immerse-loading-more">继续加载…</p>
      <p v-else-if="cards.length && !hasMore" class="more" data-test="immerse-end">到底了</p>
    </div>

    <!-- 多图时的左右切换点（P34 刻意只在这时候显示） -->
    <div v-if="curImgs.length > 1" class="navimgs">
      <button type="button" class="ni left" data-test="immerse-prev-img"
              aria-label="上一张图" @click="current && shiftImg(current, -1)">‹</button>
      <button type="button" class="ni right" data-test="immerse-next-img"
              aria-label="下一张图" @click="current && shiftImg(current, 1)">›</button>
    </div>
    <p v-else-if="curImgs.length" class="nope" data-test="immerse-single-img" aria-hidden="true" />
  </main>
</template>

<style scoped>
/* 整页占满，滚动交给 .track 自己 —— 不能让 body 滚，
   否则 snap 的基准是文档而不是这个容器 */
.immerse {
  position: fixed;
  inset: 0;
  background: #0b0b0e;
  color: #f2f2f5;
  overflow: hidden;
}

/* 顶部只有返回与计数。刻意不给标题栏：小红书这里也是留白的，
   给一条标题反而把注意力从内容上引走 */
.bar {
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: var(--xk-space-3);
  padding: calc(var(--xk-space-3) + env(safe-area-inset-top, 0px)) var(--xk-space-4);
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.45), transparent);
}
.icon {
  width: 40px;
  height: 40px;
  border: 0;
  background: none;
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  border-radius: 50%;
  -webkit-tap-highlight-color: transparent;
}
.icon:active { background: rgba(255, 255, 255, 0.14); }
.count { font-size: var(--xk-fs-13); font-variant-numeric: tabular-nums; opacity: 0.86; }

/* ⚠️ 核心：scroll-snap-type: y mandatory —— 「一屏一张」就靠这一行。
   不用手势库的理由写在脚本顶部。 */
.track {
  height: 100%;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

.slide {
  height: 100%;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  display: flex;
  flex-direction: column;
  position: relative;
}

.media {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111;
}
.pic {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.video {
  max-width: 100%;
  max-height: 100%;
  background: #000;
}

/* 多图指示器：细条，不用圆点 —— 9 张图时圆点排不开 */
.strip {
  position: absolute;
  left: 50%;
  bottom: var(--xk-space-3);
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
}
.tick {
  width: 14px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.42);
}
.tick.on { background: #fff; }

.info {
  flex: 0 0 auto;
  padding: var(--xk-space-4);
  padding-bottom: calc(var(--xk-space-4) + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, rgba(0, 0, 0, 0.86), rgba(0, 0, 0, 0.2) 70%, transparent);
}
.title {
  margin: 0 0 var(--xk-space-2);
  font-size: var(--xk-fs-20);
  line-height: 1.4;
  text-wrap: balance;
}
.brief {
  margin: 0 0 var(--xk-space-3);
  font-size: var(--xk-fs-15);
  line-height: 1.6;
  opacity: 0.82;
  /* 摘要不该在卡片上长到把图挤没：限三行 */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.who {
  display: flex;
  align-items: center;
  gap: var(--xk-space-2);
  margin-bottom: var(--xk-space-3);
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}
.avatar.ghost { background: rgba(255, 255, 255, 0.18); }
.nick { color: #fff; font-size: var(--xk-fs-15); font-weight: 600; }
.counts {
  margin-left: auto;
  font-size: var(--xk-fs-13);
  opacity: 0.78;
  font-variant-numeric: tabular-nums;
}
.num { margin: 0 2px 0 0; }

/* 「查看全文」是**导航动作** → 用 RouterLink 更贴切，但这里套在卡片上，
   整卡可点会与卡内轮播冲突，所以只留一个显式入口 */
.open {
  display: block;
  width: 100%;
  min-height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: var(--xk-fs-15);
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.open:active { background: rgba(255, 255, 255, 0.22); }

.hint {
  text-align: center;
  padding: 40vh var(--xk-space-4);
  font-size: var(--xk-fs-15);
  opacity: 0.75;
}
.hint.err { color: #ffb4a2; opacity: 1; }
.more {
  text-align: center;
  padding: var(--xk-space-4);
  font-size: var(--xk-fs-13);
  opacity: 0.6;
}

/* 左右切换点：整屏纵向中线两侧的透明热区。
   ⚠️ **不能套 40px 最小热区**：它们是覆盖在整页上的两块区域，
   真给 40px 宽会挡住卡片中间的互动。竖屏上左右切换本来就是
   「点两侧」这个约定，宽度给足 64px，热区高度是整屏。 */
.navimgs { position: absolute; inset: 0; z-index: 15; pointer-events: none; }
.ni {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 64px;
  border: 0;
  background: none;
  color: rgba(255, 255, 255, 0.55);
  font-size: 28px;
  cursor: pointer;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
.ni.left { left: 0; }
.ni.right { right: 0; }
.ni:active { background: rgba(255, 255, 255, 0.08); }

.hint, .more { pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  .icon, .open, .ni { transition: none; }
}
</style>