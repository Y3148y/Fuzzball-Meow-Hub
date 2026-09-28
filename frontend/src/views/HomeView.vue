<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { get } from '@/api/request'
import type { PingVO } from '@/api/types'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const userStore = useUserStore()

const ping = ref<PingVO | null>(null)
const envLoading = ref(false)

async function fetchPing() {
  envLoading.value = true
  try {
    ping.value = await get<PingVO>('/system/ping')
  } catch {
    ping.value = null
  } finally {
    envLoading.value = false
  }
}

async function logout() {
  userStore.logout()
  await router.replace('/login')
}

// 进来先把用户信息拉齐（守卫只校验 token 有没有，资料还是要后端给）
void userStore.loadProfile().catch(() => {
  // token 失效时拦截器已经跳登录页
})
void fetchPing()
</script>

<template>
  <main class="page">
    <header class="top">
      <span class="brand">毛球喵社</span>
      <ThemeToggle />
    </header>

    <section class="card xk-card">
      <div class="who">
        <img class="avatar" src="/mascot/m02.webp" alt="" />
        <div class="names">
          <h1 class="nickname">{{ userStore.displayName || '加载中…' }}</h1>
          <p class="username">@{{ userStore.userInfo?.username }}</p>
        </div>
      </div>

      <p v-if="userStore.userInfo?.bio" class="bio">{{ userStore.userInfo.bio }}</p>

      <dl class="stats">
        <div class="stat">
          <dt>关注</dt>
          <dd>{{ userStore.userInfo?.followCount ?? 0 }}</dd>
        </div>
        <div class="stat">
          <dt>粉丝</dt>
          <dd>{{ userStore.userInfo?.fansCount ?? 0 }}</dd>
        </div>
        <div class="stat">
          <dt>获赞</dt>
          <dd>{{ userStore.userInfo?.likeReceivedCount ?? 0 }}</dd>
        </div>
      </dl>

      <div class="acts">
        <button class="xk-btn" type="button" data-test="go-publish" @click="router.push('/publish')">
          发布笔记
        </button>
        <button
          class="xk-btn xk-btn--ghost"
          type="button"
          data-test="go-profile"
          @click="router.push('/profile')"
        >
          我的
        </button>
      </div>

      <button class="logout" type="button" data-test="home-logout" @click="logout">
        退出登录
      </button>
    </section>

    <section class="card xk-card xk-card--flat env">
      <div class="env-head">
        <h2>环境自检</h2>
        <button class="again" type="button" :disabled="envLoading" @click="fetchPing">
          {{ envLoading ? '请求中…' : '重新请求' }}
        </button>
      </div>
      <dl v-if="ping" class="kv">
        <div><dt>applicationName</dt><dd>{{ ping.applicationName }}</dd></div>
        <div><dt>machineId</dt><dd>{{ ping.machineId }}</dd></div>
        <div><dt>snowflakeId</dt><dd>{{ ping.snowflakeId }}</dd></div>
        <div><dt>雪花ID解析</dt><dd>{{ ping.snowflakeParsed }}</dd></div>
        <div><dt>serverTime</dt><dd>{{ ping.serverTime }}</dd></div>
      </dl>
      <p v-else class="env-empty">后端没响应，确认 8088 端口的服务已启动</p>
    </section>

    <p class="foot">笔记模块 P3 接入后，这里会变成信息流</p>
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
  justify-content: space-between;
}

.brand {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--xk-text-2);
}

.card {
  padding: 18px;
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

.bio {
  margin: 14px 0 0;
  color: var(--xk-text-2);
  font-size: 14px;
  line-height: 1.6;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 18px 0;
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

.acts {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.acts .xk-btn {
  flex: 1;
}

.logout {
  display: block;
  width: 100%;
  margin-top: 14px;
  padding-top: 14px;
  border: 0;
  border-top: var(--xk-stroke-w) solid var(--xk-border);
  background: none;
  color: var(--xk-text-3);
  font-size: 13px;
  cursor: pointer;
}

.env-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.env-head h2 {
  margin: 0;
  font-size: 15px;
}

.again {
  padding: 5px 12px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: 12px;
  cursor: pointer;
}

.again:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.kv {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kv > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.kv dt {
  color: var(--xk-text-3);
}

.kv dd {
  margin: 0;
  color: var(--xk-text-2);
  text-align: right;
  word-break: break-all;
}

.env-empty {
  margin: 0;
  color: var(--xk-text-3);
  font-size: 13px;
}

.foot {
  margin: 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: 12px;
}
</style>
