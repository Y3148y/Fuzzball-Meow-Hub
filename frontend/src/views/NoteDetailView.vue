<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast } from 'vant'
import { changeNoteStatus, collectNote, deleteNote, getNoteDetail, likeNote, uncollectNote, unlikeNote } from '@/api/note'
import { followUser, unfollowUser } from '@/api/follow'
import { createComment, deleteComment, likeComment, listComments, replyComment, unlikeComment } from '@/api/comment'
import { BizError } from '@/api/request'
import { ErrorCode } from '@/api/types'
import type { CommentVO, NoteVO, PageVO } from '@/api/types'
import { useUserStore } from '@/stores/user'

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
const COMMENT_MAX = 500
const draftLen = computed(() => draft.value.length)
const draftOver = computed(() => draftLen.value > COMMENT_MAX)
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

async function load() {
  loading.value = true
  errorMsg.value = ''
  notFound.value = false
  try {
    // route.params 已是 string，不要 Number()：雪花 ID 会丢精度
    note.value = await getNoteDetail(String(route.params.id))
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

onMounted(async () => {
  await load()
  await nextTick()
})
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">笔记详情</span>
    </header>

    <p v-if="loading" class="hint">加载中…</p>

    <p v-else-if="errorMsg" class="hint err" data-test="note-detail-error">{{ errorMsg }}</p>

    <article v-else-if="note" class="card xk-card" data-test="note-detail">
      <h1 class="title" data-test="note-detail-title">{{ note.title }}</h1>

      <div class="who">
        <img class="avatar" src="/mascot/m02.webp" alt="" />
        <div class="names">
          <p class="nickname" data-test="note-detail-author">{{ note.authorNickname }}</p>
          <p class="time">{{ note.createTime.replace('T', ' ').slice(0, 16) }}</p>
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
          <button type="button" class="op" @click="router.push(`/edit/${note!.id}`)" data-test="note-edit-btn">
            编辑
          </button>
          <button
            type="button"
            class="op"
            :disabled="mutating"
            @click="toggleStatus"
            data-test="note-status-btn"
          >
            {{ note!.status === 2 ? '上架' : '下架' }}
          </button>
          <button type="button" class="op danger" :disabled="mutating" @click="removeNote" data-test="note-delete-btn">
            删除
          </button>
        </div>
      </div>

      <p class="content" data-test="note-detail-content">{{ note.content }}</p>

      <ul v-if="note.images.length" class="grid" data-test="note-detail-images">
        <li v-for="src in note.images" :key="src">
          <img :src="src" :alt="note.title" loading="lazy" />
        </li>
      </ul>

      <!--
        点赞 / 收藏是真按钮，评论那一格只是个跳转到评论区的锚点。
        aria-pressed 把「当前是否已点赞」暴露给读屏软件，
        纯样式的高亮对无障碍是不存在的
      -->
      <div class="stats">
        <button
          class="stat"
          :class="{ on: isLiked }"
          type="button"
          :aria-pressed="isLiked"
          :disabled="liking"
          data-test="note-like-btn"
          @click="toggleLike"
        >
          <span class="ico">{{ isLiked ? '♥' : '♡' }}</span>
          <span class="cap">点赞</span>
          <span class="num" data-test="note-like-count">{{ note.likeCount }}</span>
        </button>

        <button
          class="stat"
          :class="{ on: isCollected }"
          type="button"
          :aria-pressed="isCollected"
          :disabled="collecting"
          data-test="note-collect-btn"
          @click="toggleCollect"
        >
          <span class="ico">{{ isCollected ? '★' : '☆' }}</span>
          <span class="cap">收藏</span>
          <span class="num" data-test="note-collect-count">{{ note.collectCount }}</span>
        </button>

        <button class="stat" type="button" data-test="note-comment-btn" @click="scrollToComments">
          <span class="ico">💬</span>
          <span class="cap">评论</span>
          <span class="num" data-test="note-comment-count">{{ note.commentCount }}</span>
        </button>
      </div>

      <p v-if="notFound" class="gone">内容已不可见</p>

      <!-- ================= 评论 ================= -->
      <section class="comments" data-test="comment-section">
        <h2 class="c-title">
          评论
          <span class="c-total" data-test="comment-total">{{ commentTotal }}</span>
        </h2>

        <!-- 发表框 -->
        <div class="editor">
          <div v-if="replyTarget" class="replying" data-test="comment-replying">
            回复 @{{ replyTarget.nickname }}
            <button type="button" data-test="comment-cancel-reply" @click="cancelReply">取消</button>
          </div>
          <textarea
            v-model="draft"
            class="c-input"
            rows="2"
            :maxlength="COMMENT_MAX + 50"
            :placeholder="draftPlaceholder"
            data-test="comment-input"
          />
          <div class="c-actions">
            <span class="c-len" :class="{ over: draftOver }" data-test="comment-len">
              {{ draftLen }}/{{ COMMENT_MAX }}
            </span>
            <button
              class="c-send"
              type="button"
              :disabled="!canSubmit"
              data-test="comment-submit"
              @click="submitComment"
            >
              发表
            </button>
          </div>
        </div>

        <p v-if="loadingComments" class="c-hint">评论加载中…</p>

        <p v-else-if="!comments.length" class="c-hint" data-test="comment-empty">还没有评论，来说两句吧</p>

        <ul v-else class="c-list" data-test="comment-list">
          <li v-for="c in comments" :key="c.id" class="c-item" data-test="comment-item">
            <img class="c-avatar" src="/mascot/m02.webp" alt="" />
            <div class="c-main">
              <p class="c-nick">{{ c.nickname }}</p>
              <p class="c-content" data-test="comment-content">{{ c.content }}</p>
              <p class="c-meta">{{ c.createTime.replace('T', ' ').slice(0, 16) }}</p>

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
    </article>
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
  gap: 10px;
}

.brand {
  font-size: 15px;
  font-weight: 700;
}

.back {
  border: 0;
  background: none;
  font-size: 26px;
  line-height: 1;
  color: var(--xk-text-2);
  cursor: pointer;
  padding: 0 4px;
}

.hint {
  margin: 0;
  padding: 40px 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: 14px;
}

.err {
  color: #e5484d;
}

.title {
  margin: 0 0 14px;
  font-size: 20px;
  line-height: 1.4;
  word-break: break-word;
}

.who {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
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
  font-size: 14px;
  font-weight: 600;
}

.time {
  margin: 2px 0 0;
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

.mine-ops {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.op {
  padding: 5px 12px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: 12px;
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
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.grid {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: var(--xk-radius-blob-sm);
  display: block;
  background: var(--xk-surface-2);
}

.stats {
  margin: 20px 0 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

/*
 * 点赞/收藏从原来的 <div> 改成了 <button>，所以要显式抹掉浏览器默认样式：
 * 不写这几条的话每个平台会给出不同的边框、背景和字体，页面会明显走样
 */
.stats .stat {
  padding: 9px 6px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  text-align: center;
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.stats .stat:active {
  transform: scale(0.95);
}

.stats .stat:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.stats .stat.on {
  border-color: #f5a623;
  background: #fff7e6;
}

.stats .ico {
  display: block;
  font-size: 18px;
  line-height: 1.2;
}

.stats .cap {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--xk-text-3);
}

.stats .num {
  display: block;
  margin-top: 3px;
  font-size: 16px;
  font-weight: 700;
}

/* ---------------- 评论 ---------------- */

.comments {
  margin-top: 8px;
  padding-top: 16px;
  border-top: var(--xk-stroke-w) solid var(--xk-border);
}

.c-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 700;
}

.c-total {
  margin-left: 4px;
  font-size: 13px;
  font-weight: 400;
  color: var(--xk-text-3);
}

.editor {
  padding: 12px;
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  margin-bottom: 16px;
}

.replying {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--xk-text-2);
}

.replying button {
  margin-left: 8px;
  border: 0;
  background: none;
  color: #e5484d;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.c-input {
  width: 100%;
  box-sizing: border-box;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-1);
  color: var(--xk-text-1);
  font: inherit;
  font-size: 14px;
  padding: 9px 10px;
  resize: vertical;
}

.c-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.c-len {
  font-size: 12px;
  color: var(--xk-text-3);
}

.c-len.over {
  color: #e5484d;
}

.c-send {
  border: 0;
  border-radius: 999px;
  padding: 7px 18px;
  background: #f5a623;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.c-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.c-hint {
  margin: 0;
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
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
  font-size: 13px;
  font-weight: 600;
  color: var(--xk-text-2);
}

.c-at {
  color: #f5a623;
}

.c-content {
  margin: 3px 0 0;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.c-meta {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--xk-text-3);
}

.c-ops {
  margin-top: 5px;
  display: flex;
  gap: 12px;
}

.c-op {
  border: 0;
  background: none;
  padding: 0;
  font-size: 12px;
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
  font-size: 12px;
  line-height: 1;
}

.c-op.like.on {
  color: #f5a623;
  font-weight: 700;
}

.reply-ops {
  margin-top: 3px;
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
  font-size: 13px;
}

.c-more {
  margin: 6px 0 0;
  font-size: 12px;
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
  font-size: 13px;
  cursor: pointer;
}

.gone {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--xk-text-3);
  text-align: center;
}
</style>
