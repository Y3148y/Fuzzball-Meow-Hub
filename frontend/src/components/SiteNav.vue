<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ThemeToggle from '@/components/ThemeToggle.vue'
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
      <button class="brand" type="button" @click="router.push('/')">
        <img class="logo" src="/mascot/m02.webp" alt="毛球喵社" />
        <span>毛球喵社</span>
      </button>

      <form class="search" role="search" @submit.prevent="goSearch">
        <input
          v-model="keyword"
          class="input"
          type="search"
          placeholder="搜笔记标题 / 正文…"
          data-test="nav-search-input"
        />
        <button class="xk-btn go" type="submit" data-test="nav-search-btn">搜索</button>
      </form>

      <nav class="links">
        <button class="link" type="button" @click="router.push('/')">首页</button>
        <button class="link" type="button" @click="router.push('/publish')">发布</button>
        <button class="link" type="button" @click="router.push('/profile')">我的</button>
        <button v-if="userStore.userInfo?.id" class="link" type="button" @click="router.push(`/follow/${userStore.userInfo!.id}`)">关注</button>
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

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: none;
  color: var(--xk-text);
  font-size: 16px;
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
  height: 38px;
  padding: 0 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text);
  font-size: 14px;
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
  height: 38px;
  padding: 0 18px;
}

.links {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
}

.link {
  padding: 6px 10px;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: 14px;
  cursor: pointer;
  border-radius: 999px;
}

.link:hover,
.link:focus-visible {
  outline: none;
  color: var(--xk-text);
  background: color-mix(in srgb, var(--xk-surface) 70%, transparent);
}

.logout {
  color: var(--xk-danger);
}
</style>