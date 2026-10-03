<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast } from 'vant'
import { changeNoteStatus, collectNote, deleteNote, getNoteDetail, likeNote, uncollectNote, unlikeNote } from '@/api/note'
import { followUser, unfollowUser } from '@/api/follow'
import { createComment, deleteComment, likeComment, listComments, replyComment, unlikeComment } from '@/api/comment'
import { BizError } from '@/api/request'
import { ErrorCode } from '@/api/types'
import type { CommentVO, NoteVO, PageVO } from '@/api/types'
import { useKeyboardInset } from '@/composables/useKeyboardInset'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/datetime'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/* ---------------- 关注作者 ---------------- */

/**
 * 详情页不光要看内容，还要能顺手关注作者。和点赞/收藏同一套范式：
 * busy 挡连点，状态永远用后端返回值写回。
 *
 * <p>这篇是自己发的就不显示按钮——接口本身会拦（40003），但没必要让
 * 作者自己看自己还要挨一次错误提示。
 */
const followingAuthor = ref(false)

const isMyNote = computed(
  () => !!note.value?.authorId && note.value.authorId === userStore.userInfo?.id,
)
const isFollowingAuthor = computed(() => note.value?.authorFollowed === true)

async function toggleFollowAuthor() {
  const target = note.value
  if (!target?.authorId || isMyNote.value || followingAuthor.value) return
  followingAuthor.value = true
  try {
    const res = isFollowingAuthor.value
      ? await unfollowUser(target.authorId)
      : await followUser(target.authorId)
    note.value = { ...target, authorFollowed: res.followed }
    // 我的关注数变了，静默刷 store
    void userStore.loadProfile().catch(() => {})
  } catch (e) {
    if (e instanceof BizError) {
      // 40001/40002 是「本地状态和后端已经不同步」，静默重拉纠正，别弹错提示
      if (e.code === ErrorCode.ALREADY_FOLLOWED || e.code === ErrorCode.NOT_FOLLOWED) {
        await load()
        return
      }
    }
    throw e
  } finally {
    followingAuthor.value = false
  }
}

/* ---------------- 作者操作：编辑 / 上下架 / 删除 ---------------- */

/**
 * P10 的编辑/上下架只有后端接口，UI 一直没做；P11 把作者操作区补上。
 * 只有作者本人能看到（接口本身也会拦，按钮隐藏只是不做无谓的探测）。
 */
const mutating = ref(false)

async function toggleStatus() {
  const target = note.value
  if (!target || mutating.value) return
  mutating.value = true
  try {
    const next = target.status === 2 ? 1 : 2
    const r = await changeNoteStatus(target.id, next as 1 | 2)
    note.value = { ...target, status: r.status }
    showSuccessToast(next === 2 ? '已下架，他人将看不到这篇' : '已重新发布')
  } catch (e) {
    if (e instanceof BizError) {
      errorMsg.value = e.message
    } else {
      throw e
    }
  } finally {
    mutating.value = false
  }
}

/**
 * 删除是不可恢复操作，必须二次确认。删除后详情页也没了，回首页。
 * 作者主页/搜索的一致性交给后端事务 + 事件，这里只处理跳转。
 */
async function removeNote() {
  const target = note.value
  if (!target || mutating.value) return
  mutating.value = true
  try {
    await showConfirmDialog({
      title: '删除这篇笔记？',
      message: '图片、点赞、收藏和评论会一起删除，且不可恢复。',
      confirmButtonText: '删除',
      confirmButtonColor: '#e5484d',
    })
  } catch {
    // 用户点了取消，showConfirmDialog 会 reject，直接吞掉
    return
  }
  try {
    await deleteNote(target.id)
    showSuccessToast('已删除')
    await router.replace('/')
  } catch (e) {
    if (e instanceof BizError) {
      errorMsg.value = e.message
    } else {
      throw e
    }
  } finally {
    mutating.value = false
  }
}

const note = ref<NoteVO | null>(null)
const loading = ref(true)
const errorMsg = ref('')
/** 404 与「已下架」分开提示：前者是地址错了，后者是内容不可看 */
const notFound = ref(false)

/* ---------------- 点赞 / 收藏 ---------------- */

/**
 * 两个互斥的 busy 标记。
 *
 * <b>为什么不做乐观更新？</b>乐观更新要处理「本地 +1 了但后端拒绝」
 * 这种情况的回滚，代码量翻倍还容易漏。点赞这个交互本身没有迫切感，
 * 等一次往返换来的是「界面数字永远是后端权威值」，P5 的并发下计数才是真的。
 * busy 标记则用来挡住连点——没有它的话，用户狂点 5 次会发出 5 个请求，
 * 其中 4 个撞 30001「已点赞」而弹 4 次错误提示。
 */
const liking = ref(false)
const collecting = ref(false)

const isLiked = computed(() => note.value?.liked === true)
const isCollected = computed(() => note.value?.collected === true)

async function toggleLike() {
  if (!note.value || liking.value) return
  liking.value = true
  try {
    // 只取「点赞这一维」的结果整给本地状态，不整包覆盖。
    // 并发点收藏时，like 响应里那个 collectCount 是在本事务快照里读出来的，
    // 可能落后于「收藏刚提交」那一刻（MySQL RR + Redis key 缺失回退 DB），
    // 整包覆盖会把收藏维度打回旧值（实测两键连点会随机回退成 0|1 或 1|0）。
    // 自己这一维是响应生成前刚提交的，必然最新；另一维用本地已有值。
    const r = isLiked.value ? await unlikeNote(note.value.id) : await likeNote(note.value.id)
    note.value = { ...note.value!, liked: r.liked, likeCount: r.likeCount }
  } catch (e) {
    if (e instanceof BizError) {
      // 30001/30002 说明本地状态已经和后端不一致（多标签页之类的），
      // 静默重拉一次详情纠正，而不是弹「已点赞」这种让人困惑的提示
      if (e.code === ErrorCode.NOTE_ALREADY_LIKED || e.code === ErrorCode.NOTE_NOT_LIKED) {
        await load()
        return
      }
    }
    throw e
  } finally {
    liking.value = false
  }
}

async function toggleCollect() {
  if (!note.value || collecting.value) return
  collecting.value = true
  try {
    // 与 toggleLike 同理：只合并收藏维度，避免并发点赞时被快照旧值回退
    const r = isCollected.value
      ? await uncollectNote(note.value.id)
      : await collectNote(note.value.id)
    note.value = { ...note.value!, collected: r.collected, collectCount: r.collectCount }
  } catch (e) {
    if (e instanceof BizError) {
      if (e.code === ErrorCode.NOTE_ALREADY_COLLECTED || e.code === ErrorCode.NOTE_NOT_COLLECTED) {
        await load()
        return
      }
    }
    throw e
  } finally {
    collecting.value = false
  }
}

/* ---------------- 评论 ---------------- */

const comments = ref<CommentVO[]>([])
const commentTotal = ref(0)
const commentPage = ref(1)
/** true 表示还有下一页 */
const hasMoreComments = ref(false)
const loadingComments = ref(true)
const submittingComment = ref(false)

const draft = ref('')
/** 正在回复哪条评论，null 表示发一级评论 */
const replyTarget = ref<CommentVO | null>(null)
const deletingId = ref('')

/** 与后端 CommentCreateDTO 的 @Size 对齐，超了直接不让发，省得白跑一趟 */
const COMMENT_MAX = 1000
const draftLen = computed(() => draft.value.length)
const draftOver = computed(() => draftLen.value > COMMENT_MAX)
/**
 * 字数计数器过了 80% 才冒出来。
 * 一上来就挂个「0/1000」纯属噪音（用户反馈"评论区设置字数上限"体验差），
 * 真要撞顶了才需要提醒，所以用渐进披露而不是常驻。
 */
const showLen = computed(() => draftLen.value > COMMENT_MAX * 0.8)
const canSubmit = computed(
  () => !submittingComment.value && draft.value.trim().length > 0 && !draftOver.value,
)

/** 输入框占位文案随回复目标变化，让用户始终知道自己在回谁 */
const draftPlaceholder = computed(() =>
  replyTarget.value ? `回复 @${replyTarget.value.nickname}` : '说点什么…',
)

async function loadComments() {
  loadingComments.value = true
  try {
    const page: PageVO<CommentVO> = await listComments(note.value!.id, commentPage.value, 10)
    comments.value = page.list
    commentTotal.value = page.total
    // total 数的是一级评论，所以用「已载入条数 < total」判断还有没有下一页
    hasMoreComments.value = comments.value.length < page.total
  } finally {
    loadingComments.value = false
  }
}

async function loadMoreComments() {
  commentPage.value += 1
  await loadComments()
}

async function submitComment() {
  if (!note.value || !canSubmit.value) return
  submittingComment.value = true
  try {
    const content = draft.value.trim()
    if (replyTarget.value) {
      await replyComment(note.value.id, content, replyTarget.value.id)
    } else {
      await createComment({ noteId: note.value.id, content })
    }
    draft.value = ''
    replyTarget.value = null
    showSuccessToast('发表成功')
    // 回到第一页，否则在第 3 页发完评论会看不到自己刚发的那条
    commentPage.value = 1
    await Promise.all([loadComments(), refreshCounters()])
  } finally {
    submittingComment.value = false
  }
}

function cancelReply() {
  replyTarget.value = null
}

async function removeComment(c: CommentVO) {
  try {
    await showConfirmDialog({
      title: '删除评论',
      message:
        c.replies && c.replies.length ? '这条评论下的回复也会一起删掉，确定吗？' : '确定删除这条评论吗？',
    })
  } catch {
    // 用户点了取消，showConfirmDialog 会 reject，直接吞掉
    return
  }
  deletingId.value = c.id
  try {
    await deleteComment(c.id)
    showSuccessToast('已删除')
    commentPage.value = 1
    await Promise.all([loadComments(), refreshCounters()])
  } finally {
    deletingId.value = ''
  }
}

/**
 * 只刷计数，不整页重载。
 *
 * <p>评论一增删，note.likeCount / commentCount 就变了。整页 load() 会把用户
 * 刚输入的评论草稿冲掉（draft 绑在输入框上，而 load 不清它，但滚动位置和
 * 展开状态会重置），所以这里只把两个计数合并回来。
 */
async function refreshCounters() {
  const fresh = await getNoteDetail(note.value!.id)
  note.value = { ...note.value!, likeCount: fresh.likeCount, collectCount: fresh.collectCount, commentCount: fresh.commentCount }
}

/* ---------------- 评论点赞 ---------------- */

/**
 * 正在点赞/取消的评论 ID（空串表示空闲）。和笔记点赞一样用 busy 挡连点，
 * 不为评论单独做乐观更新：等一次往返拿到后端权威值，界面永远不撒谎。
 */
const likingCommentId = ref('')

async function toggleCommentLike(c: CommentVO) {
  if (likingCommentId.value) return
  likingCommentId.value = c.id
  try {
    // 只合并 liked / likeCount 这一维，不整包覆盖：
    // 评论响应里的其它字段是这个事务快照的旧值，覆盖会引入过期数据
    const r = c.liked ? await unlikeComment(c.id) : await likeComment(c.id)
    patchComment(r)
  } catch (e) {
    if (e instanceof BizError) {
      // 30001/30002 说明本地状态和后端已不同步（多标签页攒出来的），
      // 静默整页重拉纠正，别弹「已经点过赞」这种让人困惑的提示
      if (e.code === ErrorCode.COMMENT_ALREADY_LIKED || e.code === ErrorCode.COMMENT_NOT_LIKED) {
        await loadComments()
        return
      }
    }
    throw e
  } finally {
    likingCommentId.value = ''
  }
}

/**
 * 把响应里的 liked / likeCount 并回对应评论。
 *
 * <p>评论列表有嵌套（根评论带 replies），先递归找 ID；找到就只并自己这一维，
 * 和「笔记点赞只合并 liked/likeCount」同一个道理——避免把响应里过期的
 * 其它字段覆盖成脏值。
 */
function patchComment(next: CommentVO) {
  const walk = (list: CommentVO[]): boolean => {
    for (const it of list) {
      if (it.id === next.id) {
        it.liked = next.liked
        it.likeCount = next.likeCount
        return true
      }
      if (it.replies?.length && walk(it.replies)) return true
    }
    return false
  }
  walk(comments.value)
}

function scrollToComments() {
  document.querySelector('[data-test="comment-section"]')?.scrollIntoView({ behavior: 'smooth' })
}

/* ---------------- 图片轮播 ---------------- */

/**
 * 详情图改轮播（v1.2 截图反馈：「多图遮挡且不能切换查看」）。
 * 计数、当前图的真实宽高比、轨道控制都挂在这几个状态上。
 *
 * <p>图框比例（--img-ratio）跟着当前图片走而不是钉死 3:4：横版截图、
 * 方图都能按自己的形状占满宽度，不留上下两条 letterbox 灰带。
 * 高度变化不影响横向滑动 —— van-swipe 的位移只依赖容器宽度。
 */
const swipeRef = ref<{ prev: () => void; next: () => void } | null>(null)
const imgIdx = ref(0)
const imgRatios = ref<number[]>([])

function onSlideChange(i: number) {
  imgIdx.value = i
}

function onImgLoad(i: number, e: Event) {
  const el = e.target as HTMLImageElement
  if (el.naturalWidth > 0 && el.naturalHeight > 0) {
    imgRatios.value[i] = el.naturalWidth / el.naturalHeight
  }
}

/** 图还没解码出来之前按 3:4 兜底，免得图框首帧闪一下塌掉 */
const activeRatio = computed(() => imgRatios.value[imgIdx.value] ?? 0.75)

async function load() {
  loading.value = true
  errorMsg.value = ''
  notFound.value = false
  try {
    // route.params 已是 string，不要 Number()：雪花 ID 会丢精度
    note.value = await getNoteDetail(String(route.params.id))
    imgIdx.value = 0
    imgRatios.value = []
    await loadComments()
  } catch (e) {
    if (e instanceof BizError) {
      if (e.code === ErrorCode.NOTE_NOT_FOUND) {
        notFound.value = true
        errorMsg.value = '这篇笔记不存在或已被删除'
      } else if (e.code === ErrorCode.NOTE_STATUS_ILLEGAL) {
        errorMsg.value = e.message
      } else if (e.code === ErrorCode.UNAUTHORIZED || e.code === ErrorCode.TOKEN_INVALID) {
        errorMsg.value = '登录已过期，请重新登录'
      } else {
        errorMsg.value = e.message
      }
    } else {
      errorMsg.value = '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

/*
 * 吸底栏与键盘
 * ---------------------------------------------------------------------------
 * pageEl/barEl 两个 ref 只为把实测值写进 CSS 变量（--kb-inset / --bar-h），
 * 吸底栏和 .page 的 padding-bottom 必须用同一个值，两处各写一遍必然漂移。
 */
const pageEl = ref<HTMLElement | null>(null)
const barEl = ref<HTMLElement | null>(null)
useKeyboardInset(pageEl)

/*
 * 长正文折叠（用户拍板：折叠 + 展开全文）
 *
 * 不用固定高度的滚动框：页面里再套一层滚动条在 Web 上是坑（滚动链、
 * Ctrl+F 搜不到、手机上像 App 套 App）。折叠用 -webkit-line-clamp，
 * 阈值移动端 8 行 / 桌面 12 行（桌面正文限宽 40em，12 行 ≈ 480 字）。
 *
 * 溢出检测：折叠态下 scrollHeight 是全文高、clientHeight 是截断后高，
 * 差值 > 4px 就是被截掉了。**测量必须在折叠态做** —— 展开后两者相等，
 * 直接量会得到"没溢出"，按钮一展开就消失。所以用 measuring 临时强制
 * 折叠一次，量完再恢复。
 */
const contentEl = ref<HTMLElement | null>(null)
const contentExpanded = ref(false)
const contentMeasuring = ref(false)
const contentOverflows = ref(false)
const contentClamped = computed(() => !contentExpanded.value || contentMeasuring.value)

async function measureContent() {
  const el = contentEl.value
  if (!el) return
  if (!contentExpanded.value) {
    contentOverflows.value = el.scrollHeight - el.clientHeight > 4
    return
  }
  contentMeasuring.value = true
  await nextTick()
  contentOverflows.value = el.scrollHeight - el.clientHeight > 4
  contentMeasuring.value = false
}

function toggleContent() {
  contentExpanded.value = !contentExpanded.value
  void measureContent()
}

onMounted(async () => {
  await load()
  await nextTick()
  startObserving()
})

/*
 * 吸底栏实测高度 → --bar-h，.page 用它补尾部空白。
 * 不能写死：输入框是多行自增的（field-sizing: content），栏会从 112px
 * 长到 188px，写死就会在打字时盖住最后一条评论（用户反馈的"遮挡"）。
 * 桌面 .actionbar 是 static，这条写了也无害（那条媒体查询不读 --bar-h）。
 */
let barObserver: ResizeObserver | null = null
let contentObserver: ResizeObserver | null = null

function startObserving() {
  if (barEl.value) {
    const el = barEl.value
    const write = () => pageEl.value?.style.setProperty('--bar-h', `${el.offsetHeight}px`)
    write()
    barObserver = new ResizeObserver(write)
    barObserver.observe(el)
  }
  if (contentEl.value) {
    // 宽度一变（旋转/改窗口），折叠阈值下的行数跟着变，重算要不要给展开按钮
    contentObserver = new ResizeObserver(() => void measureContent())
    contentObserver.observe(contentEl.value)
  }
  window.addEventListener('resize', onWinResize)
  void measureContent()
}

function onWinResize() {
  void measureContent()
}

onBeforeUnmount(() => {
  barObserver?.disconnect()
  contentObserver?.disconnect()
  window.removeEventListener('resize', onWinResize)
})
</script>

<template>
  <main ref="pageEl" class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">笔记详情</span>
    </header>

    <p v-if="loading" class="hint">加载中…</p>

    <p v-else-if="errorMsg" class="hint err" role="alert" data-test="note-detail-error">{{ errorMsg }}</p>

    <article
      v-else-if="note"
      class="card xk-card"
      data-test="note-detail"
      :style="{ '--img-ratio': String(activeRatio) }"
    >
<!--
        两个栏容器：.col-media（图片 + 评论 + 操作栏）与 .col-text（标题/作者/正文）。

        为什么必须是两个容器而不是"一个网格 + 逐个 grid-column"：
        网格的**行是跨栏共享的**。若把评论放进第 1 栏第 2 行，这一行的起点
        会是「图片高度」与「标题+作者高度」的较大值 —— 评论就被推下去了，
        而用户要的正是「评论**紧贴照片下方**、展开长文不被推动」。所以两栏
        必须是各自独立堆叠的网格项（各占一列），行高互不影响。

        桌面（≥1024）：.card 是两栏网格，两容器各占一列 →
          左 = 图片 → 评论 → 操作栏；右 = 标题 → 作者 → 正文
        移动（<1024）：两个容器 display:contents，.card 变 flex 列，
          靠 order 把图片提到全文之前（见样式里的 order 注释）→
          图片 → 标题 → 作者 → 正文 → 评论
      -->
      <div class="col-media">
        <div v-if="note.images.length" class="grid" data-test="note-detail-images">
          <van-swipe
            ref="swipeRef"
            :loop="note.images.length > 1"
            :show-indicators="note.images.length > 1"
            :lazy-render="false"
            indicator-color="#f5a623"
            @change="onSlideChange"
          >
            <van-swipe-item v-for="(src, i) in note.images" :key="src">
              <!--
                不能加 loading="lazy"：非当前张被平移出可视框后，浏览器判定
                不相交就不去加载，「两张图都解码成功」的断言会永远等不到。

                刻意不写 width/height 属性：轮播图的宽高比每张都不同，
                写死任何一对都会和 CSS 的 aspect-ratio 打架。占位由
                .grid 的 aspect-ratio 完全确定（真实尺寸在 onImgLoad 里量），
                布局不会因为图片到达而跳动，不构成 CLS。
                对比：.avatar / .c-avatar 尺寸固定，已经补上 width/height。
              -->
              <img :src="src" :alt="note.title" @load="onImgLoad(i, $event)" />
            </van-swipe-item>
          </van-swipe>

          <template v-if="note.images.length > 1">
            <button class="nav prev" type="button" aria-label="上一张" data-test="img-prev" @click="swipeRef?.prev()">‹</button>
            <button class="nav next" type="button" aria-label="下一张" data-test="img-next" @click="swipeRef?.next()">›</button>
            <span class="counter" data-test="img-counter">{{ imgIdx + 1 }}/{{ note.images.length }}</span>
          </template>
        </div>

        <p v-if="notFound" class="gone">内容已不可见</p>

        <!-- ================= 评论 ================= -->
        <section class="comments" data-test="comment-section">
          <h2 class="c-title">
            评论
            <span class="c-total" data-test="comment-total">{{ commentTotal }}</span>
          </h2>

          <p v-if="loadingComments" class="c-hint">评论加载中…</p>

          <p v-else-if="!comments.length" class="c-hint" data-test="comment-empty">还没有评论，来说两句吧</p>

          <ul v-else class="c-list" data-test="comment-list">
            <li v-for="c in comments" :key="c.id" class="c-item" data-test="comment-item">
              <img class="c-avatar" src="/mascot/m02.webp" alt="" width="28" height="28" />
              <div class="c-main">
              <p class="c-nick">{{ c.nickname }}</p>
              <p class="c-content" data-test="comment-content">{{ c.content }}</p>
              <p class="c-meta">{{ formatDateTime(c.createTime) }}</p>

              <div class="c-ops">
                <button
                  class="c-op like"
                  :class="{ on: c.liked }"
                  type="button"
                  :aria-pressed="c.liked"
                  :disabled="!!likingCommentId"
                  data-test="comment-like-btn"
                  @click="toggleCommentLike(c)"
                >
                  <span class="ico">{{ c.liked ? '♥' : '♡' }}</span>
                  <span class="num" data-test="comment-like-count">{{ c.likeCount }}</span>
                </button>
                <button
                  class="c-op"
                  type="button"
                  data-test="comment-reply-btn"
                  @click="replyTarget = c"
                >
                  回复
                </button>
                <button
                  v-if="c.mine"
                  class="c-op danger"
                  type="button"
                  :disabled="deletingId === c.id"
                  data-test="comment-delete-btn"
                  @click="removeComment(c)"
                >
                  删除
                </button>
              </div>

              <!--
                replies 是嵌套的一层，不是平铺。
                rootCommentId 全都等于根评论自己，用它做缩进依据没意义，
                直接靠 v-for 层级表达层级更直白
              -->
              <ul v-if="c.replies && c.replies.length" class="c-replies" data-test="comment-replies">
                <li v-for="r in c.replies" :key="r.id" class="c-reply" data-test="comment-reply">
                  <p class="c-nick">
                    <template v-if="r.replyNickname">
                      回复 <span class="c-at">@{{ r.replyNickname }}</span>
                    </template>
                    <template v-else>{{ r.nickname }}</template>
                  </p>
                  <p class="c-content">{{ r.content }}</p>
                  <p class="c-ops reply-ops">
                    <button
                      class="c-op like"
                      :class="{ on: r.liked }"
                      type="button"
                      :aria-pressed="r.liked"
                      :disabled="!!likingCommentId"
                      data-test="comment-reply-like-btn"
                      @click="toggleCommentLike(r)"
                    >
                      <span class="ico">{{ r.liked ? '♥' : '♡' }}</span>
                      <span class="num" data-test="comment-reply-like-count">{{ r.likeCount }}</span>
                    </button>
                  </p>
                </li>
              </ul>

              <!--
                用 replyTotal > replies.length 判「还有更多」，
                不能写 replies.length === 3：正好 3 条时会被误报成有更多
              -->
              <p
                v-if="c.replyTotal > c.replies.length"
                class="c-more"
                data-test="comment-more-replies"
              >
                共 {{ c.replyTotal }} 条回复
              </p>
            </div>
          </li>
        </ul>

        <button
          v-if="hasMoreComments"
          class="c-loadmore"
          type="button"
          data-test="comment-loadmore"
          @click="loadMoreComments"
        >
          加载更多评论
        </button>
      </section>

      <!--
        操作栏：评论输入框 + 点赞/收藏/评论三键，合成一个容器、放在评论区最下面
        （DOM 位置决定落位，不是样式炫技）：
        - 移动端（基础样式）position:fixed 吸底 —— 滚到评论区也能直接打字；
          fixed 脱离流，DOM 在哪儿都不影响它贴视口底
        - 桌面 ≥1024 撤掉 fixed 壳，静态落在 .comments 正下方，与评论区一样
          通栏、左缘对齐（缩进到右栏会像悬在评论中间，用户明确否掉了）
        三键刻意只留「图标+数字」：无边框、无底色、无文字标签（aria-label
        保留给读屏），激活才变琥珀 —— 用户反馈三个大按钮抢了正文的注意力
      -->
      <div ref="barEl" class="actionbar" data-test="action-bar">
        <!--
          行1 = 输入。通栏（移动端整条 406px），不再被三键挤成 170px
          （那是"不方便操作"的根因：pill 里只剩约 10 个汉字的位置）。
          发表按钮原来绝对定位在胶囊右下角，右侧只靠 padding 让位 56px
          —— 恰好等于按钮宽度，textarea 超过 max-height 内部滚动后，
          滚出来的行直接走到按钮底下（用户反馈的"输入时遮挡"）。
          搬进行2 之后让位不需要了，按钮热区也能做到 44×44。
        -->
        <div class="bar-input">
          <div v-if="replyTarget" class="replying" data-test="comment-replying">
            回复 @{{ replyTarget.nickname }}
            <button type="button" data-test="comment-cancel-reply" @click="cancelReply">取消</button>
          </div>
          <textarea
            v-model="draft"
            class="c-input"
            rows="1"
            :maxlength="COMMENT_MAX + 50"
            :placeholder="draftPlaceholder"
            :aria-label="replyTarget ? `回复 @${replyTarget.nickname}` : '发表评论'"
            data-test="comment-input"
          />
          <div v-if="showLen" class="c-len" :class="{ over: draftOver }" data-test="comment-len">
            {{ draftLen }}/{{ COMMENT_MAX }}
          </div>
        </div>

        <!-- 行2 = 动作行：左边发送，右边三键 -->
        <div class="bar-actions">
          <button
            class="c-send"
            type="button"
            :disabled="!canSubmit"
            aria-label="发表评论"
            title="发表评论"
            data-test="comment-submit"
            @click="submitComment"
          >
            <van-icon name="arrow" />
          </button>

          <div class="bar-keys">
            <!--
              点赞/收藏是真按钮，评论那一格只是跳转到评论区的锚点。
              aria-pressed 把「当前是否已点赞」暴露给读屏软件，
              纯样式的高亮对无障碍是不存在的；可见标签删了，aria-label 顶上
            -->
            <button
              class="kbtn"
              :class="{ on: isLiked }"
              type="button"
              :aria-pressed="isLiked"
              :disabled="liking"
              aria-label="点赞"
              title="点赞"
              data-test="note-like-btn"
              @click="toggleLike"
            >
              <van-icon :name="isLiked ? 'like' : 'like-o'" />
              <span class="num" data-test="note-like-count">{{ note.likeCount }}</span>
            </button>

            <button
              class="kbtn"
              :class="{ on: isCollected }"
              type="button"
              :aria-pressed="isCollected"
              :disabled="collecting"
              aria-label="收藏"
              title="收藏"
              data-test="note-collect-btn"
              @click="toggleCollect"
            >
              <van-icon :name="isCollected ? 'star' : 'star-o'" />
              <span class="num" data-test="note-collect-count">{{ note.collectCount }}</span>
            </button>

            <button
              class="kbtn"
              type="button"
              aria-label="评论"
              title="评论"
              data-test="note-comment-btn"
              @click="scrollToComments"
            >
              <van-icon name="chat-o" />
              <span class="num" data-test="note-comment-count">{{ note.commentCount }}</span>
            </button>
          </div>
        </div>
      </div>
        </div>
        <!-- /.col-media -->

        <!-- ================= 右栏：作者 / 标题+正文 ================= -->
        <!--
          作者区在标题**上方**、标题与正文紧挨着（用户要求：用户信息在最上面，
          标题应该和文章一起）。别再把 .who 塞回标题和正文中间。
        -->
        <div class="col-text">
          <div class="who">
            <img class="avatar" src="/mascot/m02.webp" alt="" width="34" height="34" />
            <div class="names">
              <p class="nickname" data-test="note-detail-author">{{ note.authorNickname }}</p>
              <p class="time">{{ formatDateTime(note.createTime) }}</p>
            </div>
            <button
              v-if="!isMyNote"
              class="follow"
              :class="{ on: isFollowingAuthor }"
              type="button"
              :disabled="followingAuthor"
              data-test="note-follow"
              @click="toggleFollowAuthor"
            >
              {{ isFollowingAuthor ? '已关注' : '关注' }}
            </button>

            <div v-else class="mine-ops" data-test="note-author-ops">
              <RouterLink class="op" :to="`/edit/${note!.id}`" data-test="note-edit-btn">编辑</RouterLink>
              <button
                type="button"
                class="op"
                :disabled="mutating"
                data-test="note-status-btn"
                @click="toggleStatus"
              >
                {{ note!.status === 2 ? '上架' : '下架' }}
              </button>
              <button type="button" class="op danger" :disabled="mutating" data-test="note-delete-btn" @click="removeNote">
                删除
              </button>
            </div>
          </div>

          <h1 class="title" data-test="note-detail-title">{{ note.title }}</h1>

          <p
            ref="contentEl"
            class="content"
            :class="{ clamped: contentClamped }"
            data-test="note-detail-content"
          >
            {{ note.content }}
          </p>

          <button
            v-if="contentOverflows"
            class="expand"
            type="button"
            :aria-expanded="contentExpanded"
            data-test="note-expand"
            @click="toggleContent"
          >
            {{ contentExpanded ? '收起' : '展开全文' }}
          </button>
        </div>
        <!-- /.col-text -->
    </article>
  </main>
</template>

<style scoped>
/* .page 骨架统一在 main.css，这里重复写会用 0,2,0 特异性压掉全局断点 */

.top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand {
  font-size: var(--xk-fs-15);
  font-weight: 700;
}

.back {
  min-width: 40px;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: none;
  font-size: var(--xk-fs-24);
  line-height: 1;
  color: var(--xk-text-2);
  cursor: pointer;
  padding: 0;
}

.hint {
  margin: 0;
  padding: 40px 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-14);
}

.err {
  color: #e5484d;
}

.title {
  margin: 0 0 var(--xk-space-4);
  font-size: var(--xk-fs-20);
  line-height: 1.4;
  word-break: break-word;
}

.who {
  display: flex;
  align-items: center;
  gap: var(--xk-space-3);
  margin-bottom: var(--xk-space-4);
}

.avatar {
  width: 34px;
  height: 34px;
  object-fit: contain;
}

.names {
  min-width: 0;
  flex: 1;
}

.nickname {
  margin: 0;
  font-size: var(--xk-fs-14);
  font-weight: 600;
}

.time {
  margin: 2px 0 0;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
}

/*
 * 关注/编辑/下架/删除这排小圆钮：热区从 28px 提到 40px（P13 下限）。
 * padding 5px + 12px 字高 ≈ 28px，实测 66×28，拇指点不准 —— 体检表一直在报。
 * 文字左右内边距从 14 收到 12，视觉宽度基本不变。
 */
.follow {
  flex-shrink: 0;
  min-height: 40px;
  padding: 0 12px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text);
  font-size: var(--xk-fs-12);
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

.mine-ops {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.op {
  /* 三个按钮里「编辑」是 RouterLink 的 <a>，另两个是真 <button>：Chrome 只给
     <button> 做内容居中，<a> 会把 16px 高的行盒贴在 40px 盒子顶部（实测上 2px /
     下 22px，字看着往上飘）。显式 inline-flex + align-items 让三者一致。 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 12px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text);
  font-size: var(--xk-fs-12);
  cursor: pointer;
}

.op.danger {
  color: #e5484d;
  border-color: rgba(229, 72, 77, 0.35);
}

.op:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.content {
  margin: 0;
  font-size: var(--xk-fs-16);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

/*
 * 长正文折叠：line-clamp 8 行（桌面 12 行，见 @media 里的覆盖）。
 * 阈值写 8 而不是更多 —— 手机上正文栏约 22 字/行，8 行 ≈ 176 字，
 * 再多首屏就被正文吃光了。真正的完整内容点「展开全文」拿。
 * white-space: pre-wrap 与 line-clamp 不冲突：段落空行照常保留。
 */
.content.clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 8;
  overflow: hidden;
}

/* 「展开全文 / 收起」：无边框无底色，热区 40px（P13 下限） */
.expand {
  justify-self: start;
  min-height: 40px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--xk-amber-text);
  font: inherit;
  font-size: var(--xk-fs-14);
  font-weight: 600;
  cursor: pointer;
}

.expand:hover {
  text-decoration: underline;
}

/*
 * 移动端（<1024）：单列，顺序 = **图片 → 标题 → 作者 → 正文 → 评论**。
 *
 * 实现要点：两个栏容器都是 display:contents，所以它们的子元素会**提升**成
 * .card 的 flex 子项；.card 因此改成 flex 列，再用 `order` 排出想要的顺序。
 * 为什么不能靠 DOM 顺序：桌面要的顺序（图片/评论/操作栏 在左，标题/作者/正文
 * 在右）与移动端要的顺序**互不相同**，单一 DOM 顺序满足不了两者 ——
 * display:contents + order 才能让一套 DOM 出两种排布。
 */
.card {
  display: flex;
  flex-direction: column;
  /* 间距仍由各块自己的 margin 管，这里不能加 gap，否则全部块之间多出一截 */
  gap: 0;
}

.col-media,
.col-text {
  display: contents;
}

/* order 只影响 flex 子项的视觉顺序，不影响 tab 顺序（DOM 顺序不变） */
.grid {
  order: 1;
}
/* 作者在标题上方（与右栏一致）：图片 → 作者 → 标题 → 正文 */
.who {
  order: 2;
}
.title {
  order: 3;
}
.content {
  order: 4;
}
.expand {
  order: 5;
}
.gone {
  order: 6;
}
.comments {
  order: 7;
}
/* 移动端操作栏是 position:fixed，order 无视觉影响；给 8 是为了 DOM 读起来一致 */
.actionbar {
  order: 8;
}

/*
 * 图片轮播：容器按当前图的真实宽高比定高（--img-ratio 从 <article> 继承），
 * 圆角裁住内层滑轨。桌面端它就是左栏的第一块，靠 aspect-ratio 定高，
 * 不再需要绝对定位 —— 绝对定位那套（--media-h / min-height / align-content）
 * 是为了「评论进右栏」才加的，现在两栏各自独立堆叠，那套可以整个拆掉。
 */
.grid {
  position: relative;
  margin: 0 0 16px;
  border-radius: var(--xk-radius-blob);
  overflow: hidden;
  background: var(--xk-surface-2);
  aspect-ratio: var(--img-ratio, 0.75);
  transition: aspect-ratio 0.25s ease;
}

.grid .van-swipe {
  width: 100%;
  height: 100%;
  /* Vant 自带 grab 光标，但桌面鼠标根本拖不动轮播，别骗人 */
  cursor: default;
}

/*
 * 切换控件：手机靠手指滑；桌面没有滑手势，箭头是主要入口（≥768px 才显示）。
 * 计数器任何宽度都在 —— 它同时是测试锚点。
 */
.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 34px;
  height: 34px;
  padding: 0;
  display: none;
  align-items: center;
  justify-content: center;
  border: var(--xk-stroke-w) solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(20, 22, 30, 0.5);
  color: #fff;
  font-size: var(--xk-fs-20);
  line-height: 1;
  cursor: pointer;
}

.nav.prev {
  left: 8px;
}

.nav.next {
  right: 8px;
}

.nav:hover {
  background: rgba(20, 22, 30, 0.75);
}

.counter {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 2;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(20, 22, 30, 0.55);
  color: #fff;
  font-size: var(--xk-fs-12);
}

@media (min-width: 768px) {
  .nav {
    display: inline-flex;
  }
}

/* 桌面端：左图右信息的两栏笔记页（小红书桌面版排法） */
@media (min-width: 1024px) {
  /*
   * 两栏的列宽单一来源：网格列模板与图片框宽度都取这几个变量。
   * 写死两处 440/32 的话，早晚会出现「网格改了、图框没改」的错位
   * （且错位只在桌面显形，很难第一时间联想到）。
   */
  .card {
    --xk-col1: 440px;
    --xk-colgap: 32px;
    --xk-col1-narrow: 620px; /* 无图笔记退回单栏时的带宽 */

    /*
     * 桌面两栏（用户明确要求：评论**放在照片下面**，展开长文不会推动评论）：
     *   左栏 = 图片 → 评论 → 操作栏；右栏 = 标题 → 作者 → 正文
     *
     * 两个栏容器各自是一个网格项、各占一列，因此**行高互不影响** ——
     * 正文展开变长只会让右栏变高，左栏的评论停在原地。
     * （早先那版把评论放进右栏、用 grid-row 逐个摆位，行的起点是跨栏共享的，
     * 评论会被右栏高度推下去，正好是用户不要的那个行为。）
     */
    display: grid;
    grid-template-columns: minmax(0, var(--xk-col1)) minmax(0, 1fr);
    column-gap: var(--xk-colgap);
    align-items: start; /* 两栏各自贴顶堆叠，不互相拉伸 */
  }

  /* 桌面下两个容器恢复成真正的栏（不再是 display:contents） */
  .col-media,
  .col-text {
    display: block;
    min-width: 0; /* flex/grid 子项默认 min-width:auto，长英文会顶破栏宽 */
  }

  .col-media {
    grid-column: 1;
  }

  .col-text {
    grid-column: 2;
  }

  /*
   * 右栏 40em ≈ 600px 放 17px 字符约 35 字/行，读长文比整栏宽舒服。
   * 截图反馈「注意力回到正文」：桌面正文 16→17px、行高 1.7→1.75、
   * 标题 22→24px（都在字阶 token 内）—— 正文成为页面上最大最密的文本块。
   */
  .content {
    max-width: 40em;
    font-size: var(--xk-fs-17);
    line-height: 1.75;
  }

  /* 桌面正文栏 40em 宽，12 行 ≈ 480 字，比移动端宽所以给更多行 */
  .content.clamped {
    -webkit-line-clamp: 12;
  }

  /*
   * 图片在左栏就是普通流里的第一块，高度由 aspect-ratio 与栏宽决定 ——
   * 不再需要绝对定位 / --media-h / min-height / align-content 那一整套。
   * 竖长图想封顶时用 max-height，多余部分留白而不是拉伸。
   */
  .grid {
    width: 100%;
    max-height: 72vh;
    margin: 0 0 16px;
  }

  /* 没有图片的笔记（改图后清空等）退回单栏居中，不留一整片空白左栏 */
  .card:not(:has(.grid)) {
    grid-template-columns: minmax(0, 1fr);
    max-width: var(--xk-col1-narrow);
    margin: 0 auto;
  }

  .card:not(:has(.grid)) .col-media,
  .card:not(:has(.grid)) .col-text {
    grid-column: 1;
  }

  .title {
    font-size: var(--xk-fs-24);
    margin-top: 0;
  }
}

/*
 * 轮播里的图片完整可见：图框比例已经跟着图走，contain 只是比例过渡
 * 瞬间的第二道保险。旧版「原比例 + align-self + 无 aspect-ratio」那
 * 三条注释讲的都是 grid 摆位时代的坑，轮播化之后一并作废。
 *
 * `transition: aspect-ratio/height/min-height` 严格说违反
 * web-design-guidelines 的「只过渡 transform/opacity」（这三项会触发
 * layout，不是合成器友好的）。这里刻意保留：图框比例跟着图片真实宽高比
 * 平滑变化，正是 P12 起「桌面图列不再撑出大空白」那套机制的手感来源；
 * 改成瞬变会让切图时出现明显的跳变。用一张静止的图换 0.25s 的平滑，
 * 性能上不划算（只切图时触发，不是持续动画）。
 */
.grid img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
}

/* ---------------- 操作栏：吸底的评论输入 + 点赞/收藏/评论三键 ---------------- */

/*
 * 两行结构（用户拍板）：
 *   行1 输入胶囊 —— **通栏**。旧版是一行里挤「输入 + 三键」，430 视口下
 *   pill 只剩 242px，再减掉给发表按钮让位的 56px，可输入宽度 ≈170px ≈10 个
 *   汉字，这是"不方便操作"的根因。
 *   行2 动作行 —— 左 发表（44×44 圆形），右 三键（44×44，键距 12）。
 *
 * 移动端吸底（小红书式）：滚到评论区底部也能直接打字/点赞。
 * 底色 surface（和卡片同层）+ 顶部发丝线，桌面整套撤掉（见 @media）。
 * 栏高不写死：ResizeObserver 把实测高度写进 --bar-h，.page 用它补尾部空白。
 */
.actionbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: var(--xk-space-2);
  padding: var(--xk-space-2) var(--xk-space-3)
    calc(var(--xk-space-2) + var(--kb-inset, 0px));
  border-top: var(--xk-stroke-w) solid var(--xk-border);
  background: var(--xk-surface);
  box-shadow: 0 -6px 20px rgb(18 18 18 / 6%);
}

@media (max-width: 1023px) {
  /*
   * 吸底栏会盖住页面末尾，给等高空白让最后一条评论能滚上来。
   * 覆盖全局 .page 的 padding-bottom（scoped 规则特异性 0,2,0 压得过）。
   * --bar-h 由 ResizeObserver 实测写入（折叠态 8+44+8+44+8 = 112px），
   * 写死 76px 就会在输入框长高时盖住最后一条评论（用户反馈的"遮挡"）。
   * --kb-inset 是软键盘高度：Android 靠 viewport meta 的
   * interactive-widget=resizes-content 让 layout viewport 自己缩，
   * iOS Safari 不缩，得靠 useKeyboardInset 读 visualViewport 补。
   */
  .page {
    padding-bottom: calc(var(--bar-h, 112px) + var(--kb-inset, 0px));
  }
}

.bar-input {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0; /* flex 容器里的输入框不写这条会溢出（SiteNav 搜索框前科） */
}

.replying {
  margin-bottom: var(--xk-space-1);
  font-size: var(--xk-fs-12);
  color: var(--xk-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.replying button {
  margin-left: 8px;
  border: 0;
  background: none;
  color: var(--xk-danger);
  font-size: var(--xk-fs-12);
  cursor: pointer;
  padding: 0;
  min-height: 24px;
}

.c-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text);
  font: inherit;
  font-size: var(--xk-fs-16);
  line-height: 1.4;
  /* 行1 是通栏的，右侧不用再给按钮留位置 —— 旧版那 56px 让位正好等于
     按钮宽度，textarea 内部滚动后滚出来的行直接走到按钮底下 */
  padding: 11px var(--xk-space-4);
  min-height: 44px;
  max-height: 120px;
  field-sizing: content; /* 单行 44px 起，随内容长到 120px 封顶后内部滚动 */
  resize: none;
  overflow-y: auto;
}

/*
 * 行2 动作行：左边发送、右边三键。发表按钮原来绝对定位压在胶囊右下角
 * （30px 高、热区不足 40px），搬出来后才做得成 44×44 的圆形。
 * 配色改用品牌 token：旧版是硬编码 #f5a623 底 + 白字 = 2.03:1（AA 要 4.5），
 * --xk-amber 底 + --xk-amber-ink 字是 9.69:1，与 .xk-btn 同一套。
 */
.bar-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--xk-space-3);
  min-height: 44px;
}

.c-send {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font-size: 20px;
  cursor: pointer;
  transition: transform 0.12s ease, opacity 0.12s ease;
}

.c-send:active {
  transform: scale(0.94);
}

.c-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.c-len {
  margin-top: var(--xk-space-1);
  text-align: right;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-2);
}

.c-len.over {
  color: var(--xk-danger);
}

.bar-keys {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--xk-space-3);
}

/*
 * 三键降权：无边框、无底色、无文字标签（可见标签只是「点赞」两个字，
 * 信息量为零；读屏用 aria-label，悬停用 title）。激活态只变琥珀。
 * 44×44：P13 的热区下限是 40，拇指目标按 44 做（iOS HIG）。
 */
.kbtn {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--xk-space-1);
  border: 0;
  background: none;
  color: var(--xk-text);
  font: inherit;
  cursor: pointer;
  /* 只过渡 transform（合成器友好）。不写 color：激活态换色 0.12s 才过渡
     的话，"点赞"变琥珀色会变成一段缓慢的颜色爬坡，比瞬切更像卡住 */
  transition: transform 0.12s ease;
}

.kbtn:active {
  transform: scale(0.95);
}

.kbtn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 激活态用 --xk-amber-text（按主题给值），直接写 --xk-amber 只有 2.26:1 */
.kbtn.on {
  color: var(--xk-amber-text);
}

.kbtn .van-icon {
  font-size: 20px;
}

.kbtn .num {
  font-size: var(--xk-fs-14);
  font-weight: 600;
  font-variant-numeric: tabular-nums; /* 计数跳动不抖宽度 */
}

/*
 * 桌面 ≥1024：撤掉吸底壳，操作栏静态落在**评论区最下面**（DOM 里它是
 * article 的最后一个子元素，紧跟 .comments），并且和评论区一起进右栏
 * （grid-column: 2，见上面 .card 那组规则）—— 之前是整卡通栏 1120px，
 * 而上方正文栏只有 648px，输入框甩到离文字 470px 远的地方。
 * 排版方向与手机端一致（行1 输入、行2 动作行）。
 *
 * 这块媒体查询必须写在基础 .actionbar 规则**之后**：同特异性下
 * source-order 决胜负，写在前面会被后面的 position:fixed 覆盖掉
 * （ProfileView / NoteDetailView 的 aspect-ratio 已各踩过一次）。
 * 桌面鼠标没有软键盘，--kb-inset 为 0，.page 的 padding-bottom 补丁也被
 * max-width:1023 那条媒体查询收回了。
 */
@media (min-width: 1024px) {
  .actionbar {
    position: static;
    left: auto;
    right: auto;
    bottom: auto;
    z-index: auto;
    margin: var(--xk-space-4) 0 0;
    padding: var(--xk-space-3) 0 0;
    border-top: var(--xk-stroke-w) solid var(--xk-border);
    background: none;
    box-shadow: none;
  }
}

/* ---------------- 评论 ---------------- */

.comments {
  margin-top: 8px;
  padding-top: 16px;
  border-top: var(--xk-stroke-w) solid var(--xk-border);
}

.c-title {
  margin: 0 0 12px;
  font-size: var(--xk-fs-15);
  font-weight: 700;
}

.c-total {
  margin-left: 4px;
  font-size: var(--xk-fs-13);
  font-weight: 400;
  color: var(--xk-text-3);
}

.c-hint {
  margin: 0;
  padding: 20px 0;
  text-align: center;
  font-size: var(--xk-fs-13);
  color: var(--xk-text-3);
}

.c-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.c-item {
  display: flex;
  gap: 9px;
}

.c-avatar {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  object-fit: contain;
}

.c-main {
  min-width: 0;
  flex: 1;
}

.c-nick {
  margin: 0;
  font-size: var(--xk-fs-13);
  font-weight: 600;
  color: var(--xk-text-2);
}

.c-at {
  color: #f5a623;
}

.c-content {
  margin: 3px 0 0;
  font-size: var(--xk-fs-15);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.c-meta {
  margin: 4px 0 0;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
}

.c-ops {
  margin-top: 5px;
  display: flex;
  align-items: center;
  gap: 4px;
}

/*
  评论操作钮是「视觉降权」的（无边框无底色、text-3 灰），但**热区不能降权**：
  原来 padding:0 + 无最小高度，按钮盒子就等于文字（实测 19×16 / 24×16），
  手指根本点不准。补 min-height 40 + 横向 padding，再靠 gap 收紧视觉密度。
*/
.c-op {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  min-height: 40px;
  padding: 0 4px;
  border: 0;
  background: none;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
  cursor: pointer;
}

.c-op.danger {
  color: #e5484d;
}

.c-op.like {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.c-op.like .ico {
  font-size: var(--xk-fs-12);
  line-height: 1;
}

.c-op.like.on {
  color: #f5a623;
  font-weight: 700;
}

.reply-ops {
  margin-top: 0;
}

.c-op:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.c-replies {
  list-style: none;
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.c-reply .c-content {
  font-size: var(--xk-fs-13);
}

.c-more {
  margin: 6px 0 0;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
}

.c-loadmore {
  width: 100%;
  margin-top: 14px;
  padding: 9px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  cursor: pointer;
}

.gone {
  margin: 12px 0 0;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
  text-align: center;
}
</style>
