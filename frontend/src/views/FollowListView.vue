<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BizError } from '@/api/request'
import { followUser, listFans, listFollowings, unfollowUser } from '@/api/follow'
import { ErrorCode } from '@/api/types'
import type { FollowUserVO } from '@/api/types'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/** 从路由名区分是「TA 的关注」还是「TA 的粉丝」，两个路由共用这一个组件 */
const isFans = computed(() => route.name === 'fans')

const userId = computed(() => String(route.params.id))

const rows = ref<FollowUserVO[]>([])
const loading = ref(true)
const errorMsg = ref('')
/** 正在处理哪个用户（关注/取关），一个 Set 挡连点 */
const toggling = ref(new Set<string>())

function isToggling(id: string) {
  return toggling.value.has(id)
}

const title = computed(() => (isFans.value ? '粉丝' : '关注'))

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const page = isFans.value
      ? await listFans(userId.value, 1, 20)
      : await listFollowings(userId.value, 1, 20)
    rows.value = page.list
  } catch (e) {
    if (e instanceof BizError) {
      errorMsg.value = e.message
    } else {
      errorMsg.value = '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

/**
 * 行内关注/取关按钮。`followed` 问的是「我（当前登录者）有没有关注这个用户」，
 * 不管列表页是谁的——小明看小红的关系页，按钮操作的是「我」和对方的关系。
 */
async function toggle(row: FollowUserVO) {
  if (toggling.value.has(row.id) || row.id === userStore.userInfo?.id) return
  toggling.value = new Set(toggling.value).add(row.id)
  try {
    const res = row.followed ? await unfollowUser(row.id) : await followUser(row.id)
    row.followed = res.followed
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
    toggling.value = new Set([...toggling.value].filter((id) => id !== row.id))
  }
}

function isSelf(id: string) {
  return id === userStore.userInfo?.id
}

// 路由名（follow / fans）在组件实例化时就固定了，加载一次即可
onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">{{ title }}</span>
    </header>

    <p v-if="loading" class="hint" data-test="follow-loading">加载中…</p>
    <p v-else-if="errorMsg" class="hint err" data-test="follow-error">{{ errorMsg }}</p>
    <p v-else-if="!rows.length" class="hint" data-test="follow-empty">
      {{ isFans ? '还没有粉丝' : '还没有关注任何人' }}
    </p>

    <ul v-else class="list" data-test="follow-list">
      <li v-for="row in rows" :key="row.id" class="row" data-test="follow-row">
        <button class="user" type="button" @click="router.push(`/user/${row.id}`)">
          <img class="avatar" src="/mascot/m02.webp" alt="" />
          <span class="names">
            <span class="nick" data-test="follow-nick">{{ row.nickname }}</span>
            <span class="uname">@{{ row.username }}</span>
          </span>
        </button>
        <button
          v-if="!isSelf(row.id)"
          class="follow"
          :class="{ on: row.followed }"
          type="button"
          :disabled="isToggling(row.id)"
          data-test="follow-toggle"
          @click="toggle(row)"
        >
          {{ row.followed ? '已关注' : '关注' }}
        </button>
      </li>
    </ul>
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

.hint {
  margin: 40px 0 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: 13px;
}

.hint.err {
  color: var(--xk-danger);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: var(--xk-stroke-w) solid var(--xk-border);
}

.user {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.avatar {
  width: 40px;
  height: 40px;
  object-fit: contain;
  flex-shrink: 0;
}

.names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nick {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uname {
  margin-top: 2px;
  font-size: 12px;
  color: var(--xk-text-3);
}

.follow {
  flex-shrink: 0;
  padding: 5px 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: 12px;
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
</style>