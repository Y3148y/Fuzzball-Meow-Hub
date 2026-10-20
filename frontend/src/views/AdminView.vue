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

/**
 * 处置动作按被举报对象的类型过滤。
 *
 * <p>⚠️ 后端本来就拦「给评论下架笔记」（返「评论不能下架，请改用「删除作者」或「驳回」」），
 * 但 UI 把四个动作全摆出来 —— 运营点了才看到报错，
 * 那不是「更严谨」，是让人以为系统坏了。
 * 评论能做的只有「驳回」与「禁用作者」。
 */
function actionsFor(r: AdminReportVO) {
  const isNote = r.targetType === 1
  return REPORT_ACTIONS.filter((a) => (isNote ? true : a.action !== 2 && a.action !== 3))
}

/**
 * 每一页用**人话**说明它是干什么的。
 *
 * <p>为什么要这个：运营后台原本只有三个 tab（举报/用户/笔记）+ 一堆操作按钮，
 * 第一次进来根本不知道该看哪、「驳回」和「下架笔记」差在哪。
 * 报错文案再准确，也救不回「不知道这是干什么」这件事。
 */
const TAB_HELP: Record<TabKey, string> = {
  report:
    '用户举报的内容在这里。一条举报 = 一个人举报了某条笔记或评论；处置后状态变成「已受理」或「已驳回」。',
  user: '搜索并处置账号。禁用后对方立刻无法发布与评论，也登不进来；「恢复」可以解除。',
  note: '搜索并处置内容。强制下架后笔记从所有列表里消失，用户点进去会看到「该笔记已下架」。',
}

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

    <!--
      当前页是干什么的（说人话）。
      ⚠️ 刻意**不是**一句总的说明 —— 三个页签管三件不同的事，
      一次只说当前这一件，运营才知道此刻该看哪儿。
    -->
    <p class="help" data-test="admin-help">{{ TAB_HELP[tab] }}</p>

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
    <!--
      空态也要说清楚「为什么是空的」和「东西从哪来」——
      原来只有一句「没有待处理举报」，运营会以为功能坏了。
    -->
    <p v-else-if="tab === 'report' && reports.length === 0" class="tip" data-test="admin-empty">
      当前没有{{ reportStatus === 0 ? '待处理' : '' }}举报。
      用户在笔记或评论上点「⋯ → 举报」之后，内容就会出现在这里。
    </p>
    <p v-else-if="tab === 'user' && users.length === 0" class="tip" data-test="admin-empty">
      没有匹配的用户。试试只输入昵称的一部分。
    </p>
    <p v-else-if="tab === 'note' && notes.length === 0" class="tip" data-test="admin-empty">
      没有匹配的笔记。试试只输入标题的一部分。
    </p>

    <!-- ============ 举报 ============ -->
    <ul v-else-if="tab === 'report'" class="list">
      <li v-for="r in reports" :key="r.id" class="row" data-test="admin-report-row">
        <div class="head">
          <span class="badge" :class="'t' + r.targetType">{{ r.targetType === 1 ? '笔记' : '评论' }}</span>
          <strong>{{ r.reasonText ?? '其他' }}</strong>
          <time>{{ formatDateTime(r.createTime) }}</time>
        </div>

        <!--
          举报人自己写的话（detail）。刻意**不叫「补充」** ——
          「补充」不知道是谁补的，而它其实是举报人填的原文。
        -->
        <p v-if="r.detail" class="detail" data-test="admin-report-detail">
          举报人补充：{{ r.detail }}
        </p>

        <!--
          被举报的内容。⚠️ **内容不存在时不要显示「被举报内容」这个空标签** ——
          原来是无条件渲染标签、再在下面补一句「内容已不存在」，
          读起来像漏了内容。现在合成一行说清楚。
        -->
        <p class="what" data-test="admin-report-content">
          <template v-if="r.targetExists">
            被举报的{{ r.targetType === 1 ? '笔记' : '评论' }}：{{ r.targetTitle || '（无标题）' }}
            <span v-if="r.targetContent" class="quote">「{{ r.targetContent }}」</span>
          </template>
          <template v-else>
            被举报的内容<b>已不存在</b>（作者自删或已被处置）
          </template>
        </p>

        <!--
          两个人分开写，各带标签。
          原来挤成「作者（已注销）· 举报人」一行，
          中间隔一个「·」—— 读起来像一个人的两个属性。
        -->
        <p class="who">
          <span class="k">被举报人</span>
          {{ r.targetAuthorNickname ?? '（已注销）' }}
          <span class="k">举报人</span>
          {{ r.reporterNickname ?? r.reporterUsername ?? '（已注销）' }}
        </p>

        <p v-if="!r.targetExists" class="warn" data-test="admin-target-gone">
          目标已不存在，处置只会改这条举报的状态 —— 建议直接驳回。
        </p>
        <p v-if="r.handleNote" class="handled" data-test="admin-report-note">
          处置备注：{{ r.handleNote }}
        </p>

        <div v-if="r.status === 0" class="ops">
          <!--
            ⚠️ 处置按钮**按被举报对象的类型过滤**。
            后端本来就拦「给评论下架笔记」（会报「评论不能下架」），
            但 UI 把四个动作全摆出来，运营点了才看到报错 ——
            那不是「更严谨」，是让人以为系统坏了。
            评论能做的只有「驳回」与「禁用作者」。
          -->
          <button
            v-for="a in actionsFor(r)"
            :key="a.action"
            type="button"
            data-test="admin-act"
            :class="{ danger: a.action === 3 }"
            :title="a.hint"
            :disabled="busy === r.id || (!r.targetExists && a.action === 4)"
            @click="doHandle(r, a.action, a.label)"
          >
            {{ a.label }}
          </button>
        </div>
        <p v-else class="done" data-test="admin-report-done">
          {{ r.status === 1 ? '已受理' : '已驳回' }}
          <template v-if="r.handleTime"> · {{ formatDateTime(r.handleTime) }}</template>
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

/*
 * 说明块：说这一页是干什么的。
 *
 * ⚠️ 刻意**不用** `.tip` 的样式（那是给空态/错误用的）——
 * 它是常驻内容，不该长得像一条错误提示。
 */
.help {
  margin: 0 0 var(--xk-space-3);
  padding: var(--xk-space-3);
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-left: 3px solid var(--xk-amber);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  line-height: 1.6;
}

/*
 * 列表宽度上限。
 *
 * ⚠️ 原来没有上限，于是桌面 1920px 下整行拉满 ——
 *    左边是内容、右边孤零零一个时间戳在 1700px 处，
 *    中间一千多像素的空白。**那不是「留白」，是排版失控。**
 * 880px 是一行字能读舒服的宽度，超出的部分不要。
 */
.list {
  max-width: 880px;
}

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
  /* 时间戳跟着标题走，不要被 flex 甩到行尾 */
  flex: none;
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

/* 被举报内容的原文：引号 + 更弱一点，别跟标题抢注意力 */
.quote {
  color: var(--xk-text-3);
}

.who {
  font-size: var(--xk-fs-13);
  color: var(--xk-text-3);
  margin-top: var(--xk-space-1);
}

/*
 * 「被举报人」「举报人」两个标签。
 *
 * ⚠️ 原来是把两个人挤成「作者（已注销）· 举报人」一行，
 *    中间只隔一个「·」—— 读起来像**一个人的两个属性**，
 *    而这恰恰是这页最需要说清的一件事（谁举报了谁）。
 * 现在各自带一个标签，一眼能看出这是两个人。
 */
.who .k {
  display: inline-block;
  margin: 0 var(--xk-space-2) 0 0;
  padding: 1px var(--xk-space-2);
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
}
.who .k + .k {
  margin-left: var(--xk-space-3);
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
/*
 * 「删除笔记」单独加重，避免和「驳回」被一起点。
 *
 * ⚠️ 原来用的是 `.ops button:last-child`（加重最后一个）——
 * 那是四个动作按 驳回/下架/删除/**禁用作者** 排序时的写法，
 * 于是加重色落在了「禁用作者」上，而**最不可逆的其实是「删除笔记」**
 * （它会级联删掉评论与点赞收藏，不可恢复）。
 * 改成按动作号显式标记，不再依赖「谁排在最后」。
 */
.ops button.danger {
  color: var(--xk-amber-text);
  border-color: var(--xk-amber-text);
}
</style>