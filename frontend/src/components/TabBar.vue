<script setup lang="ts">
/**
 * 移动端底部主导航（<1024px）。
 *
 * 为什么必须存在：SiteNav 是 `≥1024px` 才 `display:block`，移动端此前
 * **一整层导航都没有** —— 每页只有自己的 `.top`（品牌 + 返回），
 * 想去"关注/搜索/我的"必须退回首页再点进去。
 *
 * 三条设计约束：
 * 1. **发布凸起放中间**，与小红书一致；它是主行动，44×44 琥珀圆钮。
 * 2. **任务页与沉浸阅读页不挂**：详情页已有吸底操作栏（z-index 60），
 *    两层 fixed 元素叠在一起既挤又抢焦点。编辑/发布页同理。
 * 3. 图标名必须真实存在于 Vant 4.10 的 259 个图标里（`home` 就不存在，
 *    `home-o` 才是）。写之前先查 vant/lib/index.css。
 */
import { computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/**
 * 详情/编辑/发布/登录页不显示，见上面第 2 条。
 * 名字必须与 router/index.ts 的 `name` 逐字一致：详情页是 **`note-detail`**
 * 不是 `note`（写错过一次，表现是详情页底部同时出现吸底操作栏 + tab 栏）。
 */
const HIDDEN_ROUTES = new Set(['login', 'note-detail', 'note-edit', 'publish'])

const show = computed(() => !HIDDEN_ROUTES.has(String(route.name)))

/**
 * 把可见性同步到 <html>，`.page` 的尾部留白据此增减（见 main.css 里
 * `html[data-tabbar='on'] .page`）。单一数据源放在这里：TabBar 一旦
 * 因为别的原因改路由策略，留白会自动跟上，不会出现"导航藏了但留白还在"。
 * 只管打标记、不管断点 —— ≥1024 的桌面留白由 CSS 那条媒体查询自己排除，
 * 所以这里不必监听 resize（监听会让「改窗口大小时标记过期」这种 bug 回来）。
 */
watchEffect(() => {
  const root = document.documentElement
  if (show.value) root.dataset.tabbar = 'on'
  else delete root.dataset.tabbar
})

/**
 * 激活判定用「路由归属」而不是全等：
 * 看别人的主页/粉丝列表时不应该点亮"关注"，反之站在自己关注页要点亮。
 * 值写成 string[] 而非 readonly 元组 —— `includes` 才会接受 string 参数。
 */
const ACTIVE_OF: Record<'home' | 'follow' | 'search' | 'profile', string[]> = {
  home: ['home'],
  follow: ['follow'],
  search: ['search'],
  profile: ['profile'],
}

function isActive(tab: 'home' | 'follow' | 'search' | 'profile'): boolean {
  return ACTIVE_OF[tab].includes(String(route.name))
}

function go(tab: 'home' | 'follow' | 'search' | 'profile') {
  const name = route.name
  // 点当前 tab 回到顶部：否则在一屏到底的列表里点了没反应，像是坏了
  if (isActive(tab)) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  if (name === tab) return
  void router.push({ name: tab })
}

/**
 * 关注流要带自己的 id（路由是 /follow/:id）。
 * 未登录时不能拼 `/follow/undefined` —— 那串不进 `\d+` 约束，会落到
 * 兜底路由绕一圈再被守卫送去登录页，表现为"点了没反应"。
 */
function goFollow() {
  const id = userStore.userInfo?.id
  if (!id) {
    void router.push({ name: 'login' })
    return
  }
  if (isActive('follow')) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  void router.push({ name: 'follow', params: { id } })
}
</script>

<template>
  <nav
    v-if="show"
    class="tab-bar"
    role="navigation"
    aria-label="主导航"
    data-test="tab-bar"
  >
    <button
      class="tab"
      :class="{ on: isActive('home') }"
      type="button"
      :aria-current="isActive('home') ? 'page' : undefined"
      data-test="tab-home"
      @click="go('home')"
    >
      <van-icon name="home-o" />
      <span class="cap">首页</span>
    </button>

    <button
      class="tab"
      :class="{ on: isActive('follow') }"
      type="button"
      :aria-current="isActive('follow') ? 'page' : undefined"
      data-test="tab-follow"
      @click="goFollow"
    >
      <van-icon name="friends-o" />
      <span class="cap">关注</span>
    </button>

    <!-- 主行动：凸起 6px 的琥珀圆钮，不用文字 -->
    <RouterLink
      class="tab-plus"
      :to="{ name: 'publish' }"
      aria-label="发布笔记"
      title="发布笔记"
      data-test="tab-publish"
    >
      <van-icon name="plus" />
    </RouterLink>

    <button
      class="tab"
      :class="{ on: isActive('search') }"
      type="button"
      :aria-current="isActive('search') ? 'page' : undefined"
      data-test="tab-search"
      @click="go('search')"
    >
      <van-icon name="search" />
      <span class="cap">搜索</span>
    </button>

    <button
      class="tab"
      :class="{ on: isActive('profile') }"
      type="button"
      :aria-current="isActive('profile') ? 'page' : undefined"
      data-test="tab-profile"
      @click="go('profile')"
    >
      <van-icon name="user-o" />
      <span class="cap">我的</span>
    </button>
  </nav>
</template>

<style scoped>
/*
 * 移动端贴底；≥1024 隐藏（那时有 SiteNav 顶部通栏，两条导航并存是灾难）。
 * z-index 50 低于详情页操作栏的 60 —— 两者本就不共存，取值只为语义清晰。
 */
.tab-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  /* 每项 1 份基准宽：320px 下 5 项正好 64px/项，不会横向溢出 */
  gap: 0;
  padding: 4px 4px calc(4px + env(safe-area-inset-bottom, 0px));
  border-top: var(--xk-stroke-w) solid var(--xk-border);
  background: color-mix(in srgb, var(--xk-surface) 94%, transparent);
  backdrop-filter: blur(10px);
}

@media (min-width: 1024px) {
  .tab-bar {
    display: none;
  }
}

.tab {
  /* flex:1 1 0 而不是 auto —— auto 会被内容固有宽度顶住，五项宽窄不一 */
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  /* 44 是热区下限；视觉上只有图标+10px 文字，靠 padding 撑高 */
  min-height: 48px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font: inherit;
  cursor: pointer;
  transition: color 0.12s ease;
}

.tab .van-icon {
  font-size: 22px;
}

.cap {
  font-size: var(--xk-fs-12);
  line-height: 1.2;
}

/* 激活态用 --xk-amber-text（按主题给值，浅色深棕/深色浅琥珀，都过 4.5:1） */
.tab.on {
  color: var(--xk-amber-text);
  font-weight: 700;
}

/*
 * 发布：凸起 6px 的 44×44 琥珀圆钮。
 * 底 --xk-amber + 图形 --xk-amber-ink = 9.69:1（对比硬编码 #f5a623+白字只有 2.03:1）。
 */
.tab-plus {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 凸起靠 margin-bottom 负值，不占额外布局高度 */
  width: 44px;
  height: 44px;
  margin: 0 6px -6px;
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: 999px;
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font-size: 24px;
  box-shadow: var(--xk-shadow-hard-sm);
  text-decoration: none;
  transition: transform 0.12s ease;
}

.tab-plus:active {
  transform: translate(2px, 2px);
  box-shadow: none;
}
</style>