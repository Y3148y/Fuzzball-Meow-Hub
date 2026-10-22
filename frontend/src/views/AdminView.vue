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

    <!--
      页签。
      ⚠️ P41：原来三个页签做成了**灰色药丸**，和下面那三个筛选按钮
      （待处理/已受理/已驳回）**长得一模一样** ——
      运营根本分不清哪个是「切页面」哪个是「筛内容」。
      现在页签改成**带下划线的真 tab**（active 是琥珀下划线），
      筛选改成**分段控件**（装在一个带边框的容器里，active 是实心）。
      两组控件从此在视觉上彻底分开。
    -->
    <div class="tabs" role="tablist" aria-label="运营后台">
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

    <!-- 工具条：举报 tab 是状态筛选，用户/笔记 tab 是搜索框 -->
    <div class="toolbar">
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

    <div v-if="tab === 'report'" class="seg" role="group" aria-label="按处理状态筛选">
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
    </div><!-- /.toolbar -->

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
        <!-- ① 头行：是什么类型的举报 + 什么原因 + 什么时候 -->
        <div class="row-head">
          <span class="badge" :class="'t' + r.targetType">{{ r.targetType === 1 ? '笔记' : '评论' }}</span>
          <strong class="reason">{{ r.reasonText ?? '其他' }}</strong>
          <time>{{ formatDateTime(r.createTime) }}</time>
        </div>

        <!-- ② 主体：被举报了什么 -->
        <div class="row-main">
          <p class="what" data-test="admin-report-content">
            <span class="k">被举报的{{ r.targetType === 1 ? '笔记' : '评论' }}</span>
            <template v-if="r.targetExists">
              <!--
                P42：点进去看**原文**。
                ⚠️ 摘要里只有标题 + 前 100 字，**一张图都没有** ——
                   所以「图片违规」的举报，运营在后台根本判断不了。
                   跳原文不是锦上添花，是核实的前提。
                ⚠️ 评论举报的 targetId 是**评论 id**，要跳笔记详情得用
                   targetNoteId（评论所在的那篇笔记）—— 后端 P42 补的字段。
                ⚠️ P45：评论举报还带 `?comment=<评论id>` ——
                   运营要能**直接看到那条被举报的评论**，
                   而不是自己在几十条评论里找（评论多的笔记一页只有 10 条）。
                ⚠️ 已不存在（作者自删/已处置）时不给链接。
              -->
              <RouterLink
                v-if="r.targetNoteId"
                class="target link"
                :to="{
                  name: 'note-detail',
                  params: { id: String(r.targetNoteId) },
                  query: r.targetType === 2 ? { comment: String(r.targetId) } : {},
                }"
                data-test="admin-report-target-link"
              >
                {{ r.targetTitle || '（无标题）' }}
              </RouterLink>
              <b v-else class="target">{{ r.targetTitle || '（无标题）' }}</b>
              <span v-if="r.targetContent" class="quote">「{{ r.targetContent }}」</span>
            </template>
            <template v-else>
              <b class="gone">已不存在</b>
              <span class="muted">（作者自删或已被处置）</span>
            </template>
          </p>
          <!--
            举报人自己写的话。刻意**不叫「补充」** ——
            「补充」不知道是谁补的，而它其实是举报人填的原文。
          -->
          <p v-if="r.detail" class="detail" data-test="admin-report-detail">
            <span class="k">举报人补充</span>{{ r.detail }}
          </p>
        </div>

        <!-- ③ 双方：谁被举报了、谁举报的 -->
        <div class="who">
          <span class="person">
            <span class="k">被举报人</span>
            {{ r.targetAuthorNickname ?? '（已注销）' }}
          </span>
          <span class="person">
            <span class="k">举报人</span>
            {{ r.reporterNickname ?? r.reporterUsername ?? '（已注销）' }}
          </span>
        </div>

        <p v-if="!r.targetExists" class="warn" data-test="admin-target-gone">
          目标已不存在，处置只会改这条举报的状态 —— 建议直接驳回。
        </p>
        <p v-if="r.handleNote" class="handled" data-test="admin-report-note">
          处置备注：{{ r.handleNote }}
        </p>

        <!-- ④ 操作 -->
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
        <div class="row-head">
          <strong class="reason">{{ u.nickname }}</strong>
          <span v-if="u.role === 1" class="badge admin">管理员</span>
          <span v-if="u.status === 0" class="badge off">已禁用</span>
        </div>
        <p class="who">
          <span class="person"><span class="k">用户名</span>@{{ u.username }}</span>
          <span class="person"><span class="k">笔记</span>{{ u.noteCount }} 篇</span>
          <span class="person"><span class="k">被举报</span>{{ u.reportCount }} 次</span>
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
        <div class="row-head">
          <strong class="reason">{{ n.title ?? '（无标题）' }}</strong>
          <span class="badge" :class="'s' + n.status">
            {{ n.status === 0 ? '草稿' : n.status === 1 ? '发布中' : '已下架' }}
          </span>
          <span class="badge">{{ n.type === 2 ? '视频' : '图文' }}</span>
        </div>
        <p v-if="n.content" class="detail">{{ n.content }}</p>
        <p class="who">
          <span class="person"><span class="k">作者</span>{{ n.authorNickname ?? n.authorUsername }}</span>
          <span class="person"><span class="k">赞</span>{{ n.likeCount }}</span>
          <span class="person"><span class="k">藏</span>{{ n.collectCount }}</span>
          <span class="person"><span class="k">评</span>{{ n.commentCount }}</span>
          <span v-if="n.reportCount > 0" class="person hot">
            <span class="k">被举报</span>{{ n.reportCount }} 次
          </span>
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
/*
 * 运营后台的版式 —— **整块重写**（P41）。
 *
 * ⚠️ 为什么整块重写：原来这个 <style scoped> 里**只有 13 个选择器**
 *    （.help .list .head .badge .detail .what .quote .who .sep
 *      .warn .handled .done .ops）——
 *    **.top / .tabs / .filters / .search / .err / .tip 全都没有样式**，
 *    走的是浏览器默认：
 *      · 顶栏里的 h1 → 默认 h1（2em = 32px）→ 那个「运营后台」巨大无比
 *      · 页签与筛选的 <button> → 默认灰按钮 → **两组长得一模一样**
 *        （运营根本分不清哪个是「切页面」哪个是「筛内容」）
 *    也就是说这一页**从来没被设计过**，用户说「一塌糊涂」是准确的。
 *
 * 改法是**建立层级**，不是加装饰：
 *   ① 页签 → 带下划线的真 tab（与筛选在视觉上彻底分开）
 *   ② 筛选 → 分段控件（装在带边框的容器里，active 是实心）
 *   ③ 列表项 → 卡片（边框 + 圆角 + 底色 + 内边距），卡间有间距
 *   ④ 卡片内部 → 分四块：头行 / 主体 / 双方 / 操作
 *   ⑤ 整页限宽（960px），不再让长文本铺满 1140px
 */

/* ================= 顶栏 ================= */

.top {
  display: flex;
  align-items: center;
  gap: var(--xk-space-2);
  margin-bottom: var(--xk-space-3);
}

.top h1 {
  margin: 0;
  font-size: var(--xk-fs-20);
  font-weight: 700;
}

.back {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-20);
  line-height: 1;
  cursor: pointer;
  flex: none;
}
.back:hover { background: var(--xk-bg-soft); }

/* ================= 页签 ================= */

/*
 * 刻意做成**带下划线的 tab**（与首页「发现/关注」、主页「笔记/收藏/赞过」同款），
 * 而不是药丸 —— 药丸是下面筛选控件的形状，两组混用就分不清了。
 */
.tabs {
  display: flex;
  gap: var(--xk-space-5);
  border-bottom: var(--xk-stroke-w) solid var(--xk-border);
  margin-bottom: var(--xk-space-4);
}

.tabs button {
  min-height: 44px;          /* P13 热区下限 */
  padding: var(--xk-space-2) 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-15);
  cursor: pointer;
  /* 让下划线压在分隔线上，而不是把分隔线顶开 */
  margin-bottom: calc(-1 * var(--xk-stroke-w));
  transition: color 0.15s, border-color 0.15s;
}
.tabs button:hover { color: var(--xk-text-2); }
.tabs button.on {
  color: var(--xk-amber-text);
  border-bottom-color: var(--xk-amber);
  font-weight: 600;
}
.tabs button:focus-visible { outline: 2px solid var(--xk-amber-text); outline-offset: -2px; }

/* 待处理数：跟在「举报」后面的小红点 */
.dot {
  display: inline-block;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: 4px;
  border-radius: 999px;
  background: #e5484d;
  color: #fff;
  font-size: var(--xk-fs-12);
  font-style: normal;
  line-height: 18px;
  text-align: center;
  vertical-align: 1px;
}

/* ================= 说明块 ================= */

/*
 * 说这一页是干什么的。
 * ⚠️ 刻意**不用** `.tip` 的样式（那是给空态/错误用的）——
 * 它是常驻内容，不该长得像一条错误提示。
 */
.help {
  margin: 0 0 var(--xk-space-4);
  padding: var(--xk-space-3) var(--xk-space-4);
  border-left: 3px solid var(--xk-amber);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  line-height: 1.6;
}

/* ================= 工具条 ================= */

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--xk-space-3);
  margin-bottom: var(--xk-space-4);
  flex-wrap: wrap;
}

.search {
  display: flex;
  gap: var(--xk-space-2);
  flex: 1 1 280px;
  min-width: 0;
}
.search input {
  flex: 1 1 auto;
  min-width: 0;              /* flex 里的输入框必须给 min-width:0，否则不收缩 */
  min-height: 40px;
  padding: 0 var(--xk-space-3);
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface);
  color: var(--xk-text);
  font-size: var(--xk-fs-14);
}
.search input:focus-visible { outline: 2px solid var(--xk-amber-text); outline-offset: -1px; }
.search button {
  min-height: 40px;
  padding: 0 var(--xk-space-4);
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-14);
  cursor: pointer;
  flex: none;
}
.search button:hover { border-color: var(--xk-amber); color: var(--xk-amber-text); }

/* ================= 分段控件（状态筛选）================= */

/*
 * 刻意与页签**形状不同**：页签是下划线，筛选是「装在一个容器里的实心块」。
 * 两组控件于是不会互相冒充。
 */
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
}

.seg button {
  min-height: 32px;
  padding: 0 var(--xk-space-4);
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.12s, color 0.12s;
}
.seg button:hover { color: var(--xk-text-2); }
.seg button.on {
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font-weight: 600;
}
.seg button:focus-visible { outline: 2px solid var(--xk-amber-text); outline-offset: 1px; }

/* ================= 空态 / 错误 ================= */

.err {
  margin: 0 0 var(--xk-space-3);
  padding: var(--xk-space-3) var(--xk-space-4);
  border: var(--xk-stroke-w) solid var(--xk-danger, #d54941);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-danger, #d54941);
  font-size: var(--xk-fs-14);
}

.tip {
  margin: 0;
  padding: var(--xk-space-6) var(--xk-space-4);
  border: var(--xk-stroke-w) dashed var(--xk-border);
  border-radius: var(--xk-radius-blob);
  color: var(--xk-text-3);
  font-size: var(--xk-fs-14);
  line-height: 1.7;
  text-align: center;
}

/* ================= 列表卡片 ================= */

/*
 * 整页限宽。
 * ⚠️ 原来没有上限，桌面 1920px 下整行拉满 —— 左边是内容、
 *    右边孤零零一个时间戳在 1700px 处，中间一千多像素的空白。
 *    **那不是「留白」，是排版失控。**
 */
.list {
  max-width: 960px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  padding: var(--xk-space-4);
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: var(--xk-radius-blob);
  background: var(--xk-surface);
  box-shadow: var(--xk-shadow-hard-sm);
  margin-bottom: var(--xk-space-3);
}

/* ---------- ① 头行 ---------- */

.row-head {
  display: flex;
  gap: var(--xk-space-2);
  align-items: center;
  flex-wrap: wrap;
}
.row-head .reason {
  font-size: var(--xk-fs-16);
  font-weight: 700;
  flex: 1 1 auto;
  min-width: 0;
}
.row-head time {
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
  flex: none;   /* 时间戳跟着标题走，不要被甩到行尾 */
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
  flex: none;
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

/* ---------- ② 主体：被举报了什么 ---------- */

.row-main {
  margin-top: var(--xk-space-3);
  padding-top: var(--xk-space-3);
  border-top: var(--xk-stroke-w) solid var(--xk-border);
}

.what,
.detail {
  margin: 0;
  font-size: var(--xk-fs-14);
  color: var(--xk-text-2);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.detail { margin-top: var(--xk-space-2); }

/* 字段名前缀（"被举报的笔记" / "举报人补充"）：小一号、弱一点 */
.k {
  display: inline-block;
  margin-right: var(--xk-space-2);
  padding: 1px var(--xk-space-2);
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
  vertical-align: 1px;
}

/* 被举报内容的标题：卡片里唯一需要显眼的东西 */
.target {
  color: var(--xk-text);
  font-weight: 600;
}

/*
 * 可点的那一份：点进去看**原文**（P42）。
 * ⚠️ 必须**明显可点** —— 摘要里只有标题 + 前 100 字，一张图都没有，
 *    「图片违规」的举报只能靠看原文判断。所以这个链接不能做得像普通文字。
 */
.target.link {
  color: var(--xk-amber-text);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--xk-amber-text) 45%, transparent);
  text-underline-offset: 3px;
  cursor: pointer;
  transition: text-decoration-color 0.12s, color 0.12s;
}
.target.link:hover {
  color: var(--xk-text);
  text-decoration-color: var(--xk-amber-text);
}
.target.link:focus-visible { outline: 2px solid var(--xk-amber-text); outline-offset: 2px; }

/* 原文：引号 + 更弱一层，别跟标题抢注意力 */
.quote {
  display: block;
  margin-top: 2px;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
  /* 最多两行 —— 原文可能很长，铺满整卡会把下面的信息压到屏外 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.gone {
  color: var(--xk-amber-text);
  font-weight: 600;
}
.muted { color: var(--xk-text-3); font-size: var(--xk-fs-13); }

/* ---------- ③ 双方 ---------- */

/*
 * 「被举报人」「举报人」两个标签。
 *
 * ⚠️ 原来是把两个人挤成「作者（已注销）· 举报人」一行，
 *    中间只隔一个「·」—— 读起来像**一个人的两个属性**，
 *    而这恰恰是这页最需要说清的一件事（谁举报了谁）。
 * 现在各自一个块，并排放，一眼能看出这是两个人。
 */
.who {
  display: flex;
  flex-wrap: wrap;
  gap: var(--xk-space-2) var(--xk-space-4);
  margin: var(--xk-space-3) 0 0;
  font-size: var(--xk-fs-13);
  color: var(--xk-text-2);
}
.person { display: inline-flex; align-items: center; }
.person.hot { color: var(--xk-amber-text); font-weight: 600; }
.person.hot .k {
  background: none;
  border-color: var(--xk-amber-text);
  color: var(--xk-amber-text);
}

/* ---------- ④ 提示与处置 ---------- */

.warn,
.handled,
.done {
  margin: var(--xk-space-3) 0 0;
  font-size: var(--xk-fs-13);
  line-height: 1.6;
}
.warn { color: var(--xk-amber-text); }
.handled,
.done { color: var(--xk-text-3); }

.ops {
  display: flex;
  gap: var(--xk-space-2);
  margin-top: var(--xk-space-4);
  padding-top: var(--xk-space-3);
  border-top: var(--xk-stroke-w) solid var(--xk-border);
  flex-wrap: wrap;
}
.ops button {
  min-height: 40px;
  /* ⚠️ 内边距用 space-3 而不是 space-4：四个按钮（驳回/下架/删除/禁用作者）
     在 430px 宽的卡片里要**排成一行**才不显得乱。
     space-4 时每个按钮 88px，四个 + 间距 = 376px > 可用 354px → 最后一个换行。 */
  padding: 0 var(--xk-space-3);
  font-size: var(--xk-fs-14);
  background: var(--xk-surface-2);
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: 999px;
  color: var(--xk-text);
  cursor: pointer;
  white-space: nowrap;
}
.ops button:hover:not(:disabled) { border-color: var(--xk-amber); color: var(--xk-amber-text); }
.ops button:disabled { opacity: 0.45; cursor: not-allowed; }

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

/* ================= 桌面 ================= */

/*
 * 桌面端整页收窄。
 * 运营后台是**单列**的工作台（不是阅读流），1200px 宽的容器会让
 * 每张卡片摊得太开、左右两半互不相干。960px 是一行字能读舒服的宽度。
 */
@media (min-width: 1024px) {
  .page {
    max-width: 960px;
  }
}
</style>
