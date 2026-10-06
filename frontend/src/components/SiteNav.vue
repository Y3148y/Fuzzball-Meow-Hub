<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ThemeToggle from '@/components/ThemeToggle.vue'
import NotificationBell from '@/components/NotificationBell.vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const keyword = ref('')

function goSearch() {
  const kw = keyword.value.trim()
  if (!kw) return
  void router.push({ name: 'search', query: { keyword: kw } })
}

async function logout() {
  userStore.logout()
  await router.replace('/login')
}
</script>

<template>
  <header class="site-nav" data-test="site-nav">
    <div class="inner">
      <RouterLink class="brand" to="/">
        <img class="logo" src="/mascot/m02.webp" alt="毛球喵社" width="36" height="36" />
        <span>毛球喵社</span>
      </RouterLink>

      <form class="search" role="search" @submit.prevent="goSearch">
        <input
          v-model="keyword"
          class="input"
          type="search"
          placeholder="搜笔记标题 / 正文…"
          aria-label="搜索笔记"
          data-test="nav-search-input"
        />
        <button class="xk-btn go" type="submit" data-test="nav-search-btn">搜索</button>
      </form>

      <nav class="links">
        <RouterLink class="link" to="/">首页</RouterLink>
        <RouterLink class="link" to="/publish">发布</RouterLink>
        <RouterLink class="link" to="/profile">我的</RouterLink>
        <RouterLink
          v-if="userStore.userInfo?.id"
          class="link"
          :to="`/follow/${userStore.userInfo.id}`"
          >关注</RouterLink
        >
        <NotificationBell />
        <ThemeToggle />
        <button class="link logout" type="button" @click="logout">退出</button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.site-nav {
  position: sticky;
  top: 0;
  z-index: 10;
  background: color-mix(in srgb, var(--xk-bg) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--xk-border);
  display: none;
}

@media (min-width: 1024px) {
  .site-nav {
    display: block;
  }
}

.inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 8px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

/*
 * 品牌区、搜索框、搜索按钮、导航链接统一 40px 高。
 * 原来品牌 38（padding 撑的）、搜索框/按钮 38、logo 36 —— 体检表的热区
 * 扫描把它们全报了出来（brand 125×38 / nav-search-input 441×38），
 * 低于 P13 的 40px 下限，桌面鼠标还能忍，拇指不行。一次性对齐到 40。
 */
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 var(--xk-space-1);
  border: 0;
  background: none;
  color: var(--xk-text);
  font-size: var(--xk-fs-16);
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
}

.logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.search {
  flex: 1;
  max-width: 520px;
  display: flex;
  gap: 8px;
}

.input {
  flex: 1 1 auto;
  /* flex 子项默认 min-width:auto，会被输入框的固有宽度顶住、反向挤压容器 */
  min-width: 0;
  height: 40px;
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

/*
 * .xk-btn 自带 width:100%。在横向排列的场景里（这里和各页搜索行），
 * 100% 会按容器宽度解析 —— 按钮直接撑满整个 search 盒子，
 * 溢出到右侧导航上（实测 520px 宽压住「首页/发布」48×31px）。
 * 所以行内按钮必须显式回到 auto。
 */
.go {
  width: auto;
  flex-shrink: 0;
  height: 40px;
  padding: 0 18px;
}

.links {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
}

.link {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  padding: 6px var(--xk-space-3);
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-14);
  cursor: pointer;
  border-radius: 999px;
}

/*
 * 只给 hover 换色。**不要**在这里写 `outline: none` —— 全局 main.css 已经
 * 给 `:focus-visible` 配了焦点环（keyboard 可见），在这里清掉等于让
 * 键盘用户在这几个链接上看不到焦点位置。
 */
.link:hover {
  color: var(--xk-text);
  background: color-mix(in srgb, var(--xk-surface) 70%, transparent);
}

.logout {
  color: var(--xk-danger);
}
</style>