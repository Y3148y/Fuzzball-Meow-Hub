<script setup lang="ts">
/**
 * 运营后台（`/admin`）
 *
 * <p>三个 tab（举报 / 用户 / 笔记）对应三组处置入口。它们刻意不做成三个路由：
 * 运营的典型动作是「看一眼举报 → 处置 → 顺手禁个号」，做成三页就得多两次跳转，
 * 而跳转过程中最容易丢掉上下文（刚才那条举报是哪条）。
 *
 * <p><b>⚠️ 这一页对普通用户也会渲染出来，只是请求全部会拿到 90001。</b>
 * 「我的」页的入口按 role 隐藏了，但那一层只是界面提示、不是权限 ——
 * 直接敲 <code>#/admin</code> 一样能进。真权限在后端 AdminInterceptor，
 * 所以这里的 90001 处理是**必须的**：它不是兜底，而是这一页的正常分支。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { BizError } from '@/api/request'
import {
  REPORT_ACTIONS,
  changeUserStatus,
  forceNoteStatus,
  handleReport,
  listAdminNotes,
  listAdminReports,
  listAdminUsers,
  pendingReportCount,
} from '@/api/admin'
import type { AdminNoteItemVO, AdminReportVO, AdminUserItemVO } from '@/api/admin'
import { formatDateTime } from '@/utils/datetime'

type TabKey = 'report' | 'user' | 'note'

const router = useRouter()
const tab = ref<TabKey>('report')
const pending = ref(0)
const busy = ref('')

const reports = ref<AdminReportVO[]>([])
const users = ref<AdminUserItemVO[]>([])
const notes = ref<AdminNoteItemVO[]>([])
const loading = ref(false)
const errorMsg = ref('')
const keyword = ref('')

/** 举报 tab 的状态过滤：默认只看待处理，否则处置完的和新来的混在一起 */
const reportStatus = ref(0)

function tabOf(k: string) {
  return tab.value === k
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    if (tab.value === 'report') {
      reports.value = (await listAdminReports({ status: reportStatus.value, page: 1, size: 50 })).list
    } else if (tab.value === 'user') {
      users.value = (await listAdminUsers({ keyword: keyword.value || undefined, page: 1, size: 50 })).list
    } else {
      notes.value = (await listAdminNotes({ keyword: keyword.value || undefined, page: 1, size: 50 })).list
    }
  } catch (e) {
    errorMsg.value = e instanceof BizError ? e.message : '加载失败，请稍后重试'
    // 90001：直接把这页退回去。留着空页面让人对着「需要管理员权限」发呆
    // 不如回「我的」页 —— 那里本来就没有这个入口
    if (e instanceof BizError && e.code === 90001) router.replace('/profile')
  } finally {
    loading.value = false
  }
}

async function refreshPending() {
  try {
    pending.value = await pendingReportCount()
  } catch {
    // 红点是锦上添花，拿不到就算了，不该让它把整页变成错误态
    pending.value = 0
  }
}

function switchTab(k: TabKey) {
  tab.value = k
  keyword.value = ''
  load()
}

/* ==================== 举报处置 ==================== */

async function doHandle(row: AdminReportVO, action: number, label: string) {
  if (busy.value) return
  // 处置不可重放（后端 90003），所以点之前先确认，点之后立刻禁用按钮
  try {
    await showConfirmDialog({
      title: label,
      message:
        action === 3
          ? '删除后不可恢复，笔记下的评论与点赞收藏都会一并清掉。确定吗？'
          : action === 4
            ? '禁用后 TA 立刻无法发布与评论，且无法登录。确定吗？'
            : '确定要这样处置这条举报吗？',
      confirmButtonText: label,
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busy.value = row.id
  try {
    await handleReport(row.id, action, `${label}（运营后台）`)
    showSuccessToast('已处置')
    await load()
    await refreshPending()
  } catch (e) {
    // 90003 = 已处置过：刷新一次比再报一次错有用（多半是另一个运营刚处理过）
    if (e instanceof BizError && e.code === 90003) {
      await load()
      showToast('这条举报已经被处理过了')
      return
    }
    showToast(e instanceof BizError ? e.message : '处置失败，请稍后重试')
  } finally {
    busy.value = ''
  }
}

/* ==================== 用户禁用 ==================== */

async function toggleUser(row: AdminUserItemVO) {
  if (busy.value) return
  const next = row.status === 1 ? 0 : 1
  try {
    await showConfirmDialog({
      title: next === 0 ? '禁用账号' : '恢复账号',
      message:
        next === 0
          ? `禁用后 ${row.username} 立刻无法发布与评论，且无法登录。确定吗？`
          : `恢复后 ${row.username} 可以重新登录并发布内容。确定吗？`,
      confirmButtonText: next === 0 ? '禁用' : '恢复',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busy.value = row.id
  try {
    await changeUserStatus(row.id, next as 0 | 1)
    showSuccessToast(next === 0 ? '已禁用' : '已恢复')
    await load()
  } catch (e) {
    showToast(e instanceof BizError ? e.message : '操作失败，请稍后重试')
  } finally {
    busy.value = ''
  }
}

/* ==================== 笔记上下架 ==================== */

async function toggleNote(row: AdminNoteItemVO) {
  if (busy.value) return
  const next = row.status === 1 ? 2 : 1
  try {
    await showConfirmDialog({
      title: next === 2 ? '强制下架' : '恢复上架',
      message:
        next === 2
          ? `下架后他人看不到这篇笔记「${row.title ?? ''}」，搜索里也会撤下。作者仍能看到自己的笔记。确定吗？`
          : `恢复后这篇笔记重新对外可见并回到搜索结果。确定吗？`,
      confirmButtonText: next === 2 ? '下架' : '恢复',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busy.value = row.id
  try {
    await forceNoteStatus(row.id, next as 1 | 2)
    showSuccessToast(next === 2 ? '已下架' : '已恢复')
    await load()
  } catch (e) {
    showToast(e instanceof BizError ? e.message : '操作失败，请稍后重试')
  } finally {
    busy.value = ''
  }
}

onMounted(async () => {
  await Promise.all([load(), refreshPending()])
})
</script>

<template>
  <div class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h1>运营后台</h1>
    </header>

    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        data-test="admin-tab-report"
        :aria-selected="tabOf('report')"
        :class="{ on: tabOf('report') }"
        @click="switchTab('report')"
      >
        举报
        <em v-if="pending > 0" data-test="admin-pending" class="dot">{{ pending }}</em>
      </button>
      <button
        type="button"
        role="tab"
        data-test="admin-tab-user"
        :aria-selected="tabOf('user')"
        :class="{ on: tabOf('user') }"
        @click="switchTab('user')"
      >
        用户
      </button>
      <button
        type="button"
        role="tab"
        data-test="admin-tab-note"
        :aria-selected="tabOf('note')"
        :class="{ on: tabOf('note') }"
        @click="switchTab('note')"
      >
        笔记
      </button>
    </div>

    <label v-if="tab !== 'report'" class="search">
      <input
        v-model="keyword"
        type="search"
        :aria-label="tab === 'user' ? '按用户名或昵称搜索' : '按标题或作者搜索'"
        :placeholder="tab === 'user' ? '按用户名或昵称搜索' : '按标题或作者搜索'"
        data-test="admin-search"
        @keyup.enter="load"
      />
      <button type="button" data-test="admin-search-go" @click="load">搜索</button>
    </label>

    <div v-if="tab === 'report'" class="filters">
      <button
        v-for="s in [0, 1, 2]"
        :key="s"
        type="button"
        data-test="admin-report-status"
        :class="{ on: reportStatus === s }"
        @click="((reportStatus = s), load())"
      >
        {{ s === 0 ? '待处理' : s === 1 ? '已受理' : '已驳回' }}
      </button>
    </div>

    <p v-if="errorMsg" class="err" role="alert" data-test="admin-error">{{ errorMsg }}</p>
    <p v-else-if="loading" class="tip">加载中…</p>
    <p v-else-if="tab === 'report' && reports.length === 0" class="tip" data-test="admin-empty">
      没有{{ reportStatus === 0 ? '待处理' : '' }}举报
    </p>
    <p v-else-if="tab === 'user' && users.length === 0" class="tip" data-test="admin-empty">没有匹配的用户</p>
    <p v-else-if="tab === 'note' && notes.length === 0" class="tip" data-test="admin-empty">没有匹配的笔记</p>

    <!-- ============ 举报 ============ -->
    <ul v-else-if="tab === 'report'" class="list">
      <li v-for="r in reports" :key="r.id" class="row" data-test="admin-report-row">
        <div class="head">
          <span class="badge" :class="'t' + r.targetType">{{ r.targetType === 1 ? '笔记' : '评论' }}</span>
          <strong>{{ r.reasonText ?? '其他' }}</strong>
          <time>{{ formatDateTime(r.createTime) }}</time>
        </div>
        <p v-if="r.detail" class="detail">补充：{{ r.detail }}</p>
        <p class="what">
          被举报内容
          <template v-if="r.targetTitle">：{{ r.targetTitle }}</template>
          <template v-if="r.targetContent"> — {{ r.targetContent }}</template>
        </p>
        <p class="who">
          作者 <b>{{ r.targetAuthorNickname ?? '（已注销）' }}</b>
          <span class="sep">·</span>
          举报人 {{ r.reporterNickname ?? r.reporterUsername }}
        </p>
        <p v-if="!r.targetExists" class="warn" data-test="admin-target-gone">
          内容已不存在（作者自删或已被处置），建议直接驳回
        </p>
        <p v-if="r.handleNote" class="handled">处置备注：{{ r.handleNote }}</p>
        <div v-if="r.status === 0" class="ops">
          <button
            v-for="a in REPORT_ACTIONS"
            :key="a.action"
            type="button"
            data-test="admin-act"
            :title="a.hint"
            :disabled="busy === r.id || (!r.targetExists && (a.action === 2 || a.action === 3))"
            @click="doHandle(r, a.action, a.label)"
          >
            {{ a.label }}
          </button>
        </div>
        <p v-else class="done" data-test="admin-report-done">
          {{ r.status === 1 ? '已受理' : '已驳回' }}
        </p>
      </li>
    </ul>

    <!-- ============ 用户 ============ -->
    <ul v-else-if="tab === 'user'" class="list">
      <li v-for="u in users" :key="u.id" class="row" data-test="admin-user-row">
        <div class="head">
          <strong>{{ u.nickname }}</strong>
          <span v-if="u.role === 1" class="badge admin">管理员</span>
          <span v-if="u.status === 0" class="badge off">已禁用</span>
        </div>
        <p class="who">
          @{{ u.username }}
          <span class="sep">·</span> 笔记 {{ u.noteCount }}
          <span class="sep">·</span> 被举报 {{ u.reportCount }} 次
        </p>
        <div class="ops">
          <button
            type="button"
            data-test="admin-toggle-user"
            :disabled="busy === u.id"
            @click="toggleUser(u)"
          >
            {{ u.status === 1 ? '禁用' : '恢复' }}
          </button>
        </div>
      </li>
    </ul>

    <!-- ============ 笔记 ============ -->
    <ul v-else class="list">
      <li v-for="n in notes" :key="n.id" class="row" data-test="admin-note-row">
        <div class="head">
          <strong>{{ n.title ?? '（无标题）' }}</strong>
          <span class="badge" :class="'s' + n.status">
            {{ n.status === 0 ? '草稿' : n.status === 1 ? '发布中' : '已下架' }}
          </span>
          <span class="badge">{{ n.type === 2 ? '视频' : '图文' }}</span>
        </div>
        <p v-if="n.content" class="detail">{{ n.content }}</p>
        <p class="who">
          {{ n.authorNickname ?? n.authorUsername }}
          <span class="sep">·</span> 赞 {{ n.likeCount }}
          <span class="sep">·</span> 藏 {{ n.collectCount }}
          <span class="sep">·</span> 评 {{ n.commentCount }}
          <span v-if="n.reportCount > 0" class="sep">·</span>
          <b v-if="n.reportCount > 0">被举报 {{ n.reportCount }} 次</b>
        </p>
        <div class="ops">
          <button
            type="button"
            data-test="admin-toggle-note"
            :disabled="busy === n.id || n.status === 0"
            :title="n.status === 0 ? '草稿没有上下架状态' : ''"
            @click="toggleNote(n)"
          >
            {{ n.status === 1 ? '强制下架' : '恢复上架' }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* 字号/间距一律走 main.css 的字阶与间距阶 token（P13 起全站规矩） */
.head {
  display: flex;
  gap: var(--xk-space-2);
  align-items: center;
  flex-wrap: wrap;
}
.head strong {
  font-size: var(--xk-fs-16);
  flex: 1 1 auto;
  min-width: 0;
}
.head time {
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
}
.badge {
  font-size: var(--xk-fs-12);
  padding: 2px var(--xk-space-2);
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  /* 999px 而不是自定义 token —— 项目里没有 --xk-radius-pill，
     引用一个不存在的变量**不会报错**，只是这一行静默失效、圆角变直角。
     现有页面（NotificationView）也是直接写 999px，就跟着它 */
  border-radius: 999px;
  white-space: nowrap;
}
.badge.t1 {
  background: var(--xk-surface-2);
  color: var(--xk-amber-text);
}
.badge.t2 {
  background: var(--xk-surface-2);
}
.badge.admin {
  color: var(--xk-amber-text);
}
.badge.off,
.badge.s2 {
  color: var(--xk-amber-text);
  border-color: var(--xk-amber-text);
}
.detail,
.what {
  font-size: var(--xk-fs-14);
  color: var(--xk-text-2);
  margin-top: var(--xk-space-1);
  overflow-wrap: anywhere;
}
.who {
  font-size: var(--xk-fs-13);
  color: var(--xk-text-3);
  margin-top: var(--xk-space-1);
}
.sep {
  margin: 0 var(--xk-space-1);
}
.warn,
.handled {
  font-size: var(--xk-fs-13);
  margin-top: var(--xk-space-1);
}
.warn {
  color: var(--xk-amber-text);
}
.handled,
.done {
  color: var(--xk-text-3);
}
.ops {
  display: flex;
  gap: var(--xk-space-2);
  margin-top: var(--xk-space-3);
  flex-wrap: wrap;
}
.ops button {
  min-height: 40px;
  padding: 0 var(--xk-space-3);
  font-size: var(--xk-fs-14);
  background: var(--xk-surface-2);
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: 999px;
  color: var(--xk-text);
}
.ops button:disabled {
  opacity: 0.45;
}
/* 处置「下架/删除」这类不可逆的按钮单独加重，避免和「驳回」被一起点 */
.ops button:last-child {
  color: var(--xk-amber-text);
}
</style>