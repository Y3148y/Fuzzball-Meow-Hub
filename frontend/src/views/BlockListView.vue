<script setup lang="ts">
/**
 * 黑名单（`/blocks`）
 *
 * <p>刻意做成独立一页而不是塞进「设置」：拉黑是一件有心理成本的事
 * （「我不想看到这个人」说出来很难为情），所以入口要显眼、页面要安静。
 *
 * <p>取消拉黑用**二次确认**：误点一次就解除保护是不可逆的，
 * 而误点成本只有一次弹窗。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { BizError } from '@/api/request'
import { listBlockedUsers, unblockUser } from '@/api/report'
import { ErrorCode } from '@/api/types'
import type { BlockedUserVO } from '@/api/types'

const router = useRouter()

const rows = ref<BlockedUserVO[]>([])
const loading = ref(true)
const errorMsg = ref('')
/** 正在处理哪个用户（防连点发两次） */
const busy = ref('')

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const page = await listBlockedUsers(1, 50)
    rows.value = page.list
  } catch (e) {
    errorMsg.value = e instanceof BizError ? e.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function unblock(row: BlockedUserVO) {
  if (busy.value) return
  try {
    await showConfirmDialog({
      title: '解除拉黑',
      message: `解除后你会重新看到 ${row.nickname} 的内容。确定吗？`,
      confirmButtonText: '解除拉黑',
      cancelButtonText: '再想想',
    })
  } catch {
    // 用户点了「再想想」—— 取消不是错误，静默返回即可
    return
  }
  busy.value = row.id
  try {
    await unblockUser(row.id)
    rows.value = rows.value.filter((r) => r.id !== row.id)
    showSuccessToast('已解除拉黑')
  } catch (e) {
    // 80006 = 本来就没拉黑：说明本地状态已经错了，刷新一次比再报一次错好
    if (e instanceof BizError && e.code === ErrorCode.NOT_BLOCKED_YET) {
      await load()
      return
    }
    showToast(e instanceof BizError ? e.message : '操作失败，请稍后重试')
  } finally {
    busy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">
        <van-icon name="arrow-left" />
      </button>
      <span class="brand">黑名单</span>
    </header>

    <p class="hint-top" data-test="blocks-hint">
      拉黑后，{{ '你' }}在首页和 TA 的主页都看不到对方，对方也不会收到任何通知。
    </p>

    <p v-if="loading" class="hint" data-test="blocks-loading">加载中…</p>
    <p v-else-if="errorMsg" class="hint err" role="alert" data-test="blocks-error">
      {{ errorMsg }}
    </p>
    <p v-else-if="!rows.length" class="hint" data-test="blocks-empty">还没有拉黑任何人</p>

    <ul v-else class="list" data-test="blocks-list">
      <li v-for="row in rows" :key="row.id" class="row" data-test="block-row">
        <RouterLink class="user" :to="`/user/${row.id}`">
          <img class="avatar" src="/mascot/m02.webp" alt="" width="40" height="40" />
          <span class="names">
            <span class="nick" data-test="block-nick">{{ row.nickname }}</span>
            <span class="uname">@{{ row.username }}</span>
          </span>
        </RouterLink>
        <button
          class="unblock"
          type="button"
          :disabled="busy === row.id"
          data-test="block-unblock"
          @click="unblock(row)"
        >
          {{ busy === row.id ? '处理中' : '解除' }}
        </button>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.hint-top {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: var(--xk-radius-blob);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  line-height: 1.6;
}

.top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back {
  width: 40px;
  height: 40px;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-20);
  line-height: 1;
  cursor: pointer;
}

.brand {
  font-size: var(--xk-fs-17);
  font-weight: 700;
}

.hint {
  margin: 32px 0 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
}

.hint.err {
  color: var(--xk-danger);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
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
  text-decoration: none;
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
  font-size: var(--xk-fs-14);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uname {
  margin-top: 2px;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
}

.unblock {
  flex-shrink: 0;
  min-height: 40px;
  padding: 0 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-12);
  cursor: pointer;
}

.unblock:disabled {
  opacity: 0.6;
  cursor: progress;
}

@media (min-width: 1024px) {
  .page {
    max-width: 720px;
  }
}
</style>