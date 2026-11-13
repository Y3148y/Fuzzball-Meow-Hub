<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { changeNoteStatus, collectNote, deleteNote, getNoteDetail, likeNote, uncollectNote, unlikeNote } from '@/api/note'
import { followUser, unfollowUser } from '@/api/follow'
import { createComment, deleteComment, getComment, likeComment, listComments, replyComment, unlikeComment } from '@/api/comment'
import type { MentionVO } from '@/api/types'

/**
 * 把正文切成「纯文本 / @提及链接」两种节点
 *
 * <p>不能整段用 v-html 渲染（XSS），也不能拿后端给的 mentions 去 replace
 * 用户名 —— **用户名和昵称是两件事**：正文里写的是 `@xk_ui_follow`，
 * 后端回传的 `nickname` 是「关注搭子」，拿昵称去正文里找是找不到的。
 * 所以这里把 mentions 建成「昵称 → 用户」的表，再用正则去正文里找 @xxx，
 * 命中的变成链接，没命中的（原样）当普通文本。
 *
 * <p>字符集用 `[^\\s@]{1,32}` 而不是严格的用户名正则：这里只需要知道
 * 「@ 后面到空白为止是一段可能的昵称」，真正的匹配交给表；
 * 用严格正则的话昵称里的中文反而匹配不上（用户名规则是 `^[a-zA-Z0-9_]+$`）。
 */
function mentionNodes(content: string, mentions?: MentionVO[]) {
  const plain = [{ text: content, userId: undefined as string | undefined }]
  if (!content || !mentions?.length) return plain
  // ⚠️ **两种写法都要建表**：昵称（回传的）和用户名（正文里实际写的）。
  // 只建昵称表的话，正文里的 @xk_ui_follow 匹配不上昵称「关注搭子」，
  // 于是整个 @提及 渲染成纯文本 —— 而且**界面看不出异常**，
  // 只是那一段字不会跳而已。（后端 NoteMentionVO 只回 id + nickname，
  // 没有 username，所以这张表只能在前端用 mentionNodes 自己补。）
  // ⚠️ P30：同名昵称**允许存在**，所以表的值是**数组**而不是单个 mention。
  // 两个都叫「改名了」而都 @ 了时，按出现顺序分配（先到先得）。
  // 整条规则：同一个 mention 用过一次就从桶里取走，避免第二次 @ 同名的人
  // 又渲染成第一个人的链接 —— 那会点进错误的主页。
  const byName = new Map<string, MentionVO[]>()
  const push = (key: string | undefined | null, m: MentionVO) => {
    if (!key) return
    const arr = byName.get(key)
    if (arr) {
      if (!arr.some((x) => x.id === m.id)) arr.push(m)
    } else {
      byName.set(key, [m])
    }
  }
  for (const m of mentions) {
    // 两个键都要建：P30 起新内容写的是**昵称**，而**历史数据**写的是用户名，
    // 只建昵称键的话老笔记里的 @ 全部渲染成纯文本 —— 界面看不出异常。
    push(m.nickname, m)
    push(m.username, m)
  }
  const re = /@([^\s@]{1,32})/g
  const out: { text: string; userId?: string }[] = []
  let last = 0
  for (let mt = re.exec(content); mt; mt = re.exec(content)) {
    const bucket = byName.get(mt[1])
    const hit = bucket?.shift()
    if (!hit) continue
    if (mt.index > last) out.push({ text: content.slice(last, mt.index) })
    out.push({ text: '@' + hit.nickname, userId: hit.id })
    last = mt.index + mt[0].length
  }
  if (last === 0) return plain
  if (last < content.length) out.push({ text: content.slice(last) })
  return out.length ? out : plain
}
import { BizError } from '@/api/request'
import { ErrorCode } from '@/api/types'
import type { CommentVO, NoteListItemVO, NoteVO, PageVO } from '@/api/types'
import { getDiscoverFeed } from '@/api/feed'
import { useKeyboardInset } from '@/composables/useKeyboardInset'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/datetime'

const route = useRoute()
import MoreSheet, { type MoreAction } from '@/components/MoreSheet.vue'
import ReportSheet from '@/components/ReportSheet.vue'
import { useReportSheet } from '@/composables/useReportSheet'
import { useShare } from '@/composables/useShare'
import { blockUser } from '@/api/report'
import MentionPicker from '@/components/MentionPicker.vue'
import VideoPlayer from '@/components/VideoPlayer.vue'
import { useMentionPicker } from '@/composables/useMentionPicker'
import UserAvatar from '@/components/UserAvatar.vue'

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

/* ==================== P21：笔记的「⋯」举报 / 拉黑 ====================
 *
 * 对齐小红书（2026-10-08 查证）：举报与拉黑收在**右上角「⋯」的浮层**里。
 * P18 只把举报做在作者主页上，笔记详情页一个入口都没有 ——
 * 而「我看到一篇违规笔记想举报」这件事发生的地方就是详情页，不是 TA 的主页。
 */

const reportSheet = useReportSheet()
const { shareWithToast } = useShare()
const blockingAuthor = ref(false)

/** 评论的「⋯」动作。不能举报自己的评论（后端 80004 会拒，但这里就不该给入口） */
function commentActions(c: { id: string; mine?: boolean }): MoreAction[] {
  if (c.mine) return []
  return [{ key: 'report', label: '举报', danger: true, subname: '提交后由运营审核处理' }]
}

function onCommentMore(key: string, c: { id: string; content?: string }) {
  if (key !== 'report') return
  // 评论的正文可能有 1000 字，列表里全量展示会挤爆浮层 —— 截到 20 字足够辨认
  const brief = (c.content ?? '').slice(0, 20) || '（空评论）'
  void reportSheet.openReport(2, [{ id: c.id, title: brief }], '举报这条评论')
}

const noteActions = computed<MoreAction[]>(() => {
  if (isMyNote.value) return []
  return [
    { key: 'report', label: '举报这篇笔记', danger: true, subname: '提交后由运营审核处理' },
    {
      key: 'block',
      label: '拉黑作者',
      danger: true,
      subname: `拉黑后不再看到 ${note.value?.authorNickname} 的内容`,
    },
  ]
})

/**
 * 分享这篇笔记（P24）
 *
 * <p>摘要取标题 + 首句正文（正文可能有上千字，原生分享面板会被截断到
 * 一两行，全塞进去反而看不到）。链接用**绝对地址**：分享出去的链接
 * 被别人打开时不在我们的 origin 里，相对地址会 404。
 */
function onShare() {
  if (!note.value) return
  const title = note.value.title ?? '毛球喵社'
  const body = (note.value.content ?? '').replace(/\s+/g, ' ').trim()
  const brief = body.length > 40 ? body.slice(0, 40) + '…' : body
  void shareWithToast(title, brief ? `${title} — ${brief}` : title, window.location.href)
}

async function onNoteMore(key: string) {
  if (!note.value) return
  if (key === 'report') {
    // 目标只有一个（这篇笔记），所以不需要「选内容」那一步 ——
    // useReportSheet 在 items.length === 1 时会自动选中
    void reportSheet.openReport(1, [{ id: note.value.id, title: note.value.title ?? '（无标题）' }], '举报这篇笔记')
    return
  }
  if (key === 'block' && !blockingAuthor.value) {
    blockingAuthor.value = true
    try {
      await blockUser(note.value.authorId)
      showSuccessToast('已拉黑')
      router.back()
    } catch (e) {
      // 80005 已拉黑：重复点不该报错，直接退回去看内容（他本来就该消失了）
      if (e instanceof BizError && e.code === ErrorCode.ALREADY_BLOCKED) {
        router.back()
        return
      }
      showToast(e instanceof BizError ? e.message : '操作失败，请稍后重试')
    } finally {
      blockingAuthor.value = false
    }
  }
}
/** 有没有任何可显示的媒体（视频或图片）。P21：col-media 只在有内容时渲染 */
const hasMedia = computed(() => !!note.value?.videoUrl || (note.value?.images?.length ?? 0) > 0)

/**
 * P49：视频笔记的移动端沉浸式（黑底满宽 + 顶栏浮层 + 变量换白系）。
 * 图文笔记永远 false —— 图文保持既有的纸面卡片布局，不许被波及。
 */
const hasVideo = computed(() => !!note.value?.videoUrl)

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

/**
 * 管理员**只读**视角（P42）。
 *
 * <p>触发条件：当前用户是管理员 **且** 这篇笔记是「已下架」。
 * 已下架的笔记普通用户看不到（后端 20002），管理员能看是**专门开的口子** ——
 * 运营要核实被举报的内容，必须看得到原文和图片。
 *
 * <p>⚠️ <b>为什么必须只读</b>：管理员的点赞/收藏会**混进普通用户的计数**，
 * 而这个计数被用来排序发现流（P23 热度分）——
 * 运营看一眼违规内容，结果把别人的内容顶上去，
 * 那是<b>审核行为污染推荐</b>，而且这种污染没人会发现（计数看起来很正常）。
 *
 * <p>评论列表**保留**（只读是指不能互动）—— 运营核实「评论违规」的举报
 * 时要看得到评论区。
 */
const isAdminReadonly = computed(
  () => userStore.userInfo?.role === 1 && note.value?.status === 2,
)

/**
 * 管理员只读视角下没有吸底操作栏 → 把给它的尾部留白收掉。
 *
 * <p>`.page` 的 padding-bottom 是 `calc(var(--bar-h, 112px) + ...)`，
 * 而 `--bar-h` 由 ResizeObserver 实测写入（操作栏不在就没有这个值），
 * 于是会退回默认的 112px —— 一个没有底栏的页面白占 112px。
 */
watch(isAdminReadonly, (ro) => {
  const p = pageEl.value
  if (!p) return
  if (ro) p.style.setProperty('--bar-h', '0px')
  else p.style.removeProperty('--bar-h')
})
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

/**
 * P45：要定位的那条评论 id（来自 URL 的 `?comment=xxx`）。
 *
 * <p>运营从举报后台点「被举报的那条评论」时带的参数。
 * 空串 = 不定位（普通浏览）。
 */
const highlightCommentId = computed(() => String(route.query.comment ?? ''))
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

/* ================= P29：@ 提及候选选择器 ================= */
const mention = useMentionPicker(draft, '[data-test=comment-input]')

/** textarea 的 keydown 必须手动转发给选择器（Enter/Tab 在 textarea 里不冒泡） */
function onDraftKeydown(e: KeyboardEvent) {
  mention.onDraftKeydown(e, () => void submitComment())
}

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

/**
 * P45：URL 带 `?comment=xxx` 时**定位到那条评论**。
 *
 * <p>场景：运营从举报后台点「被举报的那条评论」→ 跳到
 * `#/note/{noteId}?comment={commentId}`。
 *
 * <p>⚠️ **那条评论可能在第一页之外** —— 评论多的笔记一页只有 10 条，
 * 光靠 listComments 找不到它。所以要在第一页里**找不到时单独拉一次**
 * （后端新加的 `GET /api/comment/{id}`），插进列表再高亮、滚过去。
 *
 * <p>⚠️ 拿不到就**静默放弃**：定位是锦上添花，不该让整页加载失败
 * （比如那条评论已被删了、或它所在的笔记对我不可见）。
 */
async function locateComment() {
  const cid = highlightCommentId.value
  if (!cid) return
  // 先看第一页里有没有
  const flat = comments.value.flatMap((c) => [c, ...(c.replies ?? [])])
  if (flat.some((c) => c.id === cid)) {
    await nextTick()
    scrollToComment(cid)
    return
  }
  try {
    const c = await getComment(cid)
    // 插到列表末尾：它在第一页之外，位置本来就无所谓 —— 高亮 + 滚动才是重点
    comments.value = [...comments.value, c]
    await nextTick()
    scrollToComment(cid)
  } catch {
    // 静默：那条评论可能已被删，或它所在的笔记对我不可见
  }
}

function scrollToComment(cid: string) {
  const el = document.querySelector(`[data-test="comment-item"][data-comment-id="${cid}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
        // ⚠️ mentionUserIds 必须在 draft 清空**之前**取：它按「正文里还留着
        // 那段 @」过滤，清空后就全被滤掉了。
        const mentionUserIds = mention.mentionUserIds()
        let created
        if (replyTarget.value) {
          created = await replyComment(note.value.id, content, replyTarget.value.id, mentionUserIds)
        } else {
          created = await createComment({ noteId: note.value.id, content, mentionUserIds })
        }
        // P30：把「打了 @ 但没生效」变成一句明确的话。
        // 后端返回的 mentions 就是权威答案 —— 不需要额外字段，
        // 也不用为了「重名/拼错/已注销」三种情况各加一个错误码。
        const missed = mention.unresolvedMentions(created?.mentions ?? [])
        draft.value = ''
        mention.resetPicked()
        replyTarget.value = null
        showSuccessToast('发表成功')
        if (missed.length) {
          // ⚠️ 必须**在成功提示之后**弹：Vant 的 toast 同一时刻只保留一个，
          // 后弹的会顶掉先弹的。反过来写的话，用户只看到「发表成功」，
          // 那条「没 @ 到人」等于没提示 —— 而这正是它存在的理由。
          showToast(`${missed.map((t) => '@' + t).join('、')} 没 @ 到人，请从候选里选`)
        }
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
const activeRatio = computed(() => {
  // 视频笔记：比例用自己的元数据（播放器 loadedmetadata 上报），9/16 兜底 ——
  // 手机视频以竖屏为主，3:4 兜底会先闪一个「太胖」的框
  if (note.value?.videoUrl) return videoRatio.value || 9 / 16
  return imgRatios.value[imgIdx.value] ?? 0.75
})

/** P48：视频真实宽高比（w/h），VideoPlayer 的 @ratio 回上来；0 = 还没量到 */
const videoRatio = ref(0)
function onVideoRatio(w: number, h: number) {
  if (w > 0 && h > 0) videoRatio.value = w / h
}

/* ==================== P51：PC 弹出面板（左瀑布 + 右面板 + ←→ 上下篇） ====================
 *
 * 小红书 web（explore/{id}）点卡片**不跳页**：左瀑布保持，右侧滑出详情面板，
 * ←→ 直接切上/下篇。这里做成同一路由的**外壳**：≥1024 时页面变成
 * 「左瀑布（发现流，sticky 内滚）+ 右面板（现有详情内容）」两列，
 * 列表与面板互不重载 —— 左瀑布只加载一次，面板随路由参数切换重拉。
 *
 * ⚠️ 刻意**不改路由表**：#/note/:id 的链接、分享、契约全部依赖它，
 * 换成 /explore/:id 的收益是名字像，代价是一整圈链接与测试。
 *
 * ⚠️ 发现流**不含自己发的**（后端 `n.user_id != ?`）——
 * 从「我的」主页点进自己笔记时当前卡不在 rail 里：无高亮、上下篇按钮隐藏，
 * 不装作有上/下篇。切到别人的笔记后 rail 照常出现。
 */
const railNotes = ref<NoteListItemVO[]>([])
const railLoading = ref(false)

async function loadRail() {
  railLoading.value = true
  try {
    // size=50 一次取够上下篇的弹药库；排序与首页发现流一致
    const r = await getDiscoverFeed(1, 50)
    railNotes.value = r.list
  } catch {
    railNotes.value = [] // rail 挂了不影响右侧面板
  } finally {
    railLoading.value = false
  }
}

/** 当前笔记在 rail 列表里的位置；-1 = 不在（自己的笔记 / 私密内容等） */
const railIdx = computed(() =>
  railNotes.value.findIndex((n) => n.id === String(route.params.id)),
)
const prevRail = computed(() =>
  railIdx.value > 0 ? railNotes.value[railIdx.value - 1] : undefined,
)
const nextRail = computed(() =>
  railIdx.value >= 0 && railIdx.value < railNotes.value.length - 1
    ? railNotes.value[railIdx.value + 1]
    : undefined,
)

function goRailNote(id: string) {
  if (id === String(route.params.id)) return
  // replace 不塞历史栈：←→ 是「换一篇看」，浏览器后退键应该回到来源列表页
  router.replace('/note/' + id)
}

const railEl = ref<HTMLElement | null>(null)

async function scrollRailToCurrent() {
  await nextTick()
  const el = railEl.value?.querySelector('[data-rail-cur]') as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest' })
}

/*
 * 同路由参数切换（←→ / 点 rail 卡）时重拉：vue-router 对同组件不同参数
 * **复用实例**，onMounted 的 load 只在首次进页面跑 —— 没有 watch 的话
 * 切上下篇 URL 变了、内容还是旧的。
 */
watch(
  () => route.params.id,
  async (id, old) => {
    if (!id || id === old) return
    await load()
    await nextTick()
    startObserving()
    window.scrollTo({ top: 0 })
    void scrollRailToCurrent()
    /*
     * P52：入场收尾。swipeEnter 是 replace 前设好的 pre 态（新 card 挂载时
     * 已带着 56px/opacity:0），这里双 rAF 先让初始态完成一帧绘制，
     * 再切成 run 态让基础 transition 把它滑回原位；transition 完成后
     * 撤掉类 —— transform 回到 none，吸底操作栏的包含块还给视口。
     */
    if (swipeEnter.value) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          swipeEnter.value =
            swipeEnter.value === 'pre-next' ? 'run-next'
            : swipeEnter.value === 'pre-prev' ? 'run-prev'
            : ''
        }),
      )
      setTimeout(() => {
        if (swipeEnter.value === 'run-next' || swipeEnter.value === 'run-prev') {
          swipeEnter.value = ''
        }
        swipeSwitching = false
      }, 320)
    } else {
      swipeSwitching = false
    }
  },
)

function onRailKey(e: KeyboardEvent) {
  if (!window.matchMedia('(min-width: 1024px)').matches) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'ArrowLeft' && prevRail.value) {
    e.preventDefault()
    goRailNote(prevRail.value.id)
  } else if (e.key === 'ArrowRight' && nextRail.value) {
    e.preventDefault()
    goRailNote(nextRail.value.id)
  }
}

/* ==================== P52：移动端上滑切下一条 / 下滑切上一篇 ====================
 *
 * 手感对齐小红书 app：在详情页滚到底继续上拉 → 下一条；在顶部继续下拉 → 上一篇。
 * 数据**完全复用 P51 的 rail**（railNotes/prevRail/nextRail 与视口无关），
 * 只是桌面用瀑布+按钮表达、移动端用手势表达同一份数据。
 *
 * ⚠️ 不能 transform article.card 本体做 peek：吸底操作栏（action-bar）是 card
 * 的**子元素**且 position:fixed —— card 上只要出现非 none 的 transform，
 * 它的 fixed 包含块就从视口变成 card，吸底当场失效（P21 的核心修复被破坏）。
 * 所以三个阶段分开处理：
 *   peek（未松手）：card 只做 opacity 微降（opacity 不创建 fixed 包含块），
 *     方向感交给提示药丸（swipe-hint）跟手升起；
 *   出场：transform 滑走 —— 此时底栏以 card 为包含块**跟着滑走**，
 *     恰好是小红书「整页滑走」的观感；
 *   入场：三态类（enter-pre 无过渡落位 → enter-run 过渡滑入 → 撤类回 none，
 *     底栏回吸底）。transform: none 与值之间的过渡按 identity 插值。
 */
const swipePeek = ref(0)
const swipeDragging = ref(false)
const swipeDir = ref<'' | 'next' | 'prev'>('')
const swipeLeave = ref<'' | 'next' | 'prev'>('')
const swipeEnter = ref<'' | 'pre-next' | 'pre-prev' | 'run-next' | 'run-prev'>('')
let swipeStartY = 0
let swipeStartX = 0
let swipeLock: '' | 'none' | 'x' | 'next' | 'prev' = ''
let swipeSwitching = false

const swipeHintText = computed(() => {
  if (swipeDir.value === 'next' && nextRail.value) return `下一条：${nextRail.value.title}`
  if (swipeDir.value === 'prev' && prevRail.value) return `上一篇：${prevRail.value.title}`
  return ''
})

const SWIPE_LOCK = 24 // 先锁方向：横向滚轮播、纵向滚页面，24px 内不表态
const SWIPE_MAX = 140 // peek 上限（阻尼后）
const SWIPE_COMMIT = 90 // 松手触发阈值
const SWIPE_DAMP = 0.4 // 阻尼：手指走 1px、peek 走 0.4px，模拟「拉不动」的手感

function onSwipeStart(e: TouchEvent) {
  if (!window.matchMedia('(max-width: 1023px)').matches) return
  if (swipeSwitching || loading.value || !note.value) return
  const t = e.touches[0]
  if (!t) return
  const target = e.target as HTMLElement | null
  // 输入/视频/吸底栏的触摸是它们自己的事（打字滚动、拖进度条、点按钮）
  if (target?.closest('input, textarea, [contenteditable="true"], video, [data-test="action-bar"]')) {
    return
  }
  swipeStartY = t.clientY
  swipeStartX = t.clientX
  swipeLock = ''
  swipePeek.value = 0 // 上一轮手势的残余清掉（hint 的 rise 别带旧值出现）
  swipeDragging.value = true
}

function onSwipeMove(e: TouchEvent) {
  if (!swipeDragging.value) return
  const t = e.touches[0]
  if (!t) return
  const dy = t.clientY - swipeStartY
  const dx = t.clientX - swipeStartX
  if (!swipeLock) {
    if (Math.abs(dy) < SWIPE_LOCK && Math.abs(dx) < SWIPE_LOCK) return
    if (Math.abs(dx) > Math.abs(dy)) {
      swipeLock = 'x' // 横向：轮播/别的手势，不参与
    } else {
      const doc = document.documentElement
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 4
      const atTop = window.scrollY <= 0
      if (dy < 0 && atBottom && nextRail.value) swipeLock = 'next'
      else if (dy > 0 && atTop && prevRail.value) swipeLock = 'prev'
      else swipeLock = 'none' // 中段滑动就是普通滚动
    }
    if (swipeLock === 'x' || swipeLock === 'none') {
      swipeDragging.value = false
      return
    }
    swipeDir.value = swipeLock
  }
  // 已锁定为边缘切换手势：拦住浏览器滚动/回弹（P27 的 overscroll-behavior 只压回弹）
  e.preventDefault()
  const over = swipeLock === 'next' ? Math.max(0, -dy) : Math.max(0, dy)
  const peek = Math.min(SWIPE_MAX, over * SWIPE_DAMP)
  swipePeek.value = peek
}

function onSwipeEnd() {
  if (!swipeDragging.value) return
  swipeDragging.value = false
  if ((swipeLock === 'next' || swipeLock === 'prev') && swipePeek.value >= SWIPE_COMMIT) {
    void commitSwipe(swipeLock)
  } else {
    swipePeek.value = 0 // 回弹（card 的 opacity 过渡 + hint 淡出）
  }
  swipeLock = ''
  swipeDir.value = ''
}

async function commitSwipe(dir: 'next' | 'prev') {
  const target = dir === 'next' ? nextRail.value : prevRail.value
  if (!target || swipeSwitching) return
  swipeSwitching = true
  // 出场：transform 滑走（底栏以 card 为包含块，跟着一起滑走 = 整页滑观感）
  swipeLeave.value = dir
  await new Promise((r) => setTimeout(r, 240))
  // 先置 loading：让旧 card 在撤 leave 类的**同一帧**卸载（v-if 分支切换），
  // 否则 transform 归零会有 1 帧旧内容弹回原位的回闪
  loading.value = true
  swipeLeave.value = ''
  // 入场初始态在 replace **前**设好：新 card 挂载的第一帧就带着 pre 类，
  // 不闪「原位 → 56px」的一帧
  swipeEnter.value = dir === 'next' ? 'pre-next' : 'pre-prev'
  goRailNote(target.id) // watch(params) 会 load + 入场 + 收尾
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  notFound.value = false
  try {
    // route.params 已是 string，不要 Number()：雪花 ID 会丢精度
    note.value = await getNoteDetail(String(route.params.id))
    imgIdx.value = 0
    imgRatios.value = []
    videoRatio.value = 0
    await loadComments()
    // P45：URL 带 ?comment=xxx 时定位到那条评论（运营从举报后台点进来）
    await locateComment()
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
  void loadRail()
  window.addEventListener('keydown', onRailKey)
  // P52：手势绑在 main 上（冒泡），passive:false 只在 move 上（要 preventDefault）
  pageEl.value?.addEventListener('touchstart', onSwipeStart, { passive: true })
  pageEl.value?.addEventListener('touchmove', onSwipeMove, { passive: false })
  pageEl.value?.addEventListener('touchend', onSwipeEnd, { passive: true })
  pageEl.value?.addEventListener('touchcancel', onSwipeEnd, { passive: true })
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
  /*
   * P51：先断旧再绑新 —— ←→ 切换时 loading 会把 actionbar/正文 DOM 销毁重建，
   * ResizeObserver 若一直攥着旧元素，新元素的 --bar-h / 折叠测量就没人更新了。
   * 这也是为什么 watch(params) 重拉后必须再调一次 startObserving。
   */
  barObserver?.disconnect()
  contentObserver?.disconnect()
  barObserver = null
  contentObserver = null
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
  window.removeEventListener('keydown', onRailKey)
  const page = pageEl.value
  page?.removeEventListener('touchstart', onSwipeStart)
  page?.removeEventListener('touchmove', onSwipeMove)
  page?.removeEventListener('touchend', onSwipeEnd)
  page?.removeEventListener('touchcancel', onSwipeEnd)
})
</script>

<template>
  <main ref="pageEl" class="page note-detail-page" :class="{ immerse: hasVideo }">
    <!--
      P51：PC 弹出面板（小红书 explore/{id} 的形状）——左瀑布 + 右详情面板。
      ⚠️ aside 必须是 main 的**第一个子元素**：桌面外壳用 grid 摆位
      （.rail 占 col1 跨全部行、其余直接子元素全部进 col2），现有的
      `.page > .top` 等选择器一个都不用动。
      移动端 <1024 整块 display:none（50 张图用了 loading=lazy，
      不可见的懒图不会真的发起请求）——上滑切换是 P52，别提前抢活。
    -->
    <aside ref="railEl" class="rail" data-test="detail-rail" aria-label="更多笔记">
      <p v-if="railLoading" class="rail-hint" data-test="detail-rail-loading">加载中…</p>
      <p v-else-if="!railNotes.length" class="rail-hint" data-test="detail-rail-empty">暂无更多笔记</p>
      <div v-else class="rail-cols">
        <RouterLink
          v-for="rn in railNotes"
          :key="rn.id"
          class="rail-item"
          :class="{ cur: rn.id === String(route.params.id) }"
          :data-rail-cur="rn.id === String(route.params.id) ? '' : undefined"
          :aria-current="rn.id === String(route.params.id) ? 'true' : undefined"
          :to="'/note/' + rn.id"
          data-test="detail-rail-item"
        >
          <img
            v-if="rn.cover"
            class="rail-cover"
            :src="rn.cover"
            :alt="rn.title"
            loading="lazy"
          />
          <span v-else class="rail-cover" aria-hidden="true"></span>
          <strong class="rail-title">{{ rn.title }}</strong>
        </RouterLink>
      </div>
    </aside>

    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">笔记详情</span>
      <button
        class="share-btn"
        type="button"
        aria-label="分享这篇笔记"
        data-test="note-share"
        @click="onShare"
      >
        <van-icon name="share-o" />
      </button>
      <!--
        「⋯」放顶栏而不是作者区：小红书是笔记**右上角**的「⋯」，
        而作者区那一行已经放了关注/作者本人操作了，再塞两个会重演
        UserView 那个「六个元素挤一行 flex」的坏（AGENTS P21 段）。
      -->
      <MoreSheet
        v-if="!isMyNote"
        :actions="noteActions"
        label="这篇笔记的操作"
        testid="note-more"
        @select="onNoteMore"
      />
    </header>

    <!-- 举报弹窗（三个入口共用：这里 / 评论项 / 作者主页） -->
    <ReportSheet />

    <p v-if="loading" class="hint">加载中…</p>

    <p v-else-if="errorMsg" class="hint err" role="alert" data-test="note-detail-error">{{ errorMsg }}</p>

    <article
      v-else-if="note"
      class="card xk-card"
      :class="{
        'has-video': hasVideo,
        dim: swipeDragging && swipePeek > 8,
        'leave-next': swipeLeave === 'next',
        'leave-prev': swipeLeave === 'prev',
        'enter-pre': swipeEnter === 'pre-next' || swipeEnter === 'pre-prev',
        'enter-run': swipeEnter === 'run-next' || swipeEnter === 'run-prev',
        'from-below': swipeEnter === 'pre-next',
        'from-above': swipeEnter === 'pre-prev',
      }"
      data-test="note-detail"
      :style="{ '--img-ratio': String(activeRatio) }"
    >
    <!--
      P42：管理员只读视角的提示条。
      ⚠️ 必须**明说**「你是以管理员身份看到的、这是已下架的内容」——
      否则运营会以为这是普通用户能看到的东西，
      而普通用户其实看不到（后端对非作者返 20002）。
    -->
    <p v-if="isAdminReadonly" class="admin-note" role="status" data-test="note-admin-banner">
      这篇笔记已被下架 —— 你以<strong>管理员</strong>身份查看（只读，不能点赞/评论）。
    </p>
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
<!--
  P21：加 v-if。`col-media` 原来**无条件渲染**，所以一篇既没有视频也没有图片的
  笔记（5 篇 P6 遗留的无图文字笔记）会得到一个**完全空的**媒体块 ——
  再叠加下面 .card:not(:has(.grid)) 的单栏兜底，用户看到的就是
  「标题上面莫名其妙空一大块、图片也不显示」（2026-10-08 手测）。
  空块不是「留白」，它是渲染错误。
-->
<div v-if="hasMedia" class="col-media">
      <!--
        视频。**放在图片区之前并用 v-if 排他**：`videoUrl` 存在时这篇是视频笔记
        （后端 publish 时 type=2 要求 videoUrl 非空），不该同时渲染图。
        P48：原生 controls 换成 VideoPlayer 自绘进度条 + 清晰度切换；
        poster 用视频抽帧封面（发布/转码时推导进 cover 列）。
      -->
      <div v-if="note.videoUrl" class="videobox" data-test="note-video">
        <VideoPlayer
          :src="note.videoUrl"
          :qualities="note.videoQualities ?? undefined"
          :poster="note.cover ?? undefined"
          @ratio="onVideoRatio"
        />
      </div>

      <div v-if="!note.videoUrl && note.images.length" class="grid" data-test="note-detail-images">
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
            <li
              v-for="c in comments"
              :key="c.id"
              class="c-item"
              :class="{ hit: c.id === highlightCommentId }"
              :data-comment-id="c.id"
              data-test="comment-item"
            >
              <UserAvatar class="c-avatar" :avatar="c.avatar" :nickname="c.nickname" :size="28" />
              <div class="c-main">
              <p class="c-nick">{{ c.nickname }}</p>
              <!--
                    P29：评论正文里的 @ 也渲染成链接。
                    复用与笔记正文**同一个** mentionNodes —— 两处各写一份
                    解析必然漂移，而漂移的症状是「某处 @ 能点某处不能」，
                    没有报错也没有异常外观。
                    注意 :key 用 index：切片重建出来的节点每次都是新对象，
                    用 text 做 key 会在内容相同的相邻片段上撞 key。
                  -->
                  <p class="c-content" data-test="comment-content">
                    <template v-for="(seg, si) in mentionNodes(c.content, c.mentions)" :key="si">
                      <RouterLink v-if="seg.userId" :to="{ name: 'user', params: { id: seg.userId } }">{{ seg.text }}</RouterLink>
                      <span v-else>{{ seg.text }}</span>
                    </template>
                  </p>
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
                <!--
                  举报别人的评论。小红书是「长按评论 → 浮层 → 举报」，
                  这里做成常驻的「⋯」：长按在桌面端没有对应手势，
                  而评论那一行本来就已有「赞 / 回复 / 删除」三个按钮，
                  再加一个宽度只有 44px 的「⋯」不会像 UserView 那样挤爆。
                -->
                <MoreSheet
                  v-if="!c.mine"
                  :actions="commentActions(c)"
                  label="这条评论的操作"
                  :testid="'comment-more-' + c.id"
                  @select="(k: string) => onCommentMore(k, c)"
                />
              </div>

              <!--
                replies 是嵌套的一层，不是平铺。
                rootCommentId 全都等于根评论自己，用它做缩进依据没意义，
                直接靠 v-for 层级表达层级更直白
              -->
              <ul v-if="c.replies && c.replies.length" class="c-replies" data-test="comment-replies">
                <li
                  v-for="r in c.replies"
                  :key="r.id"
                  class="c-reply"
                  :class="{ hit: r.id === highlightCommentId }"
                  :data-comment-id="r.id"
                  data-test="comment-reply"
                >
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
      <div v-if="!isAdminReadonly" ref="barEl" class="actionbar" data-test="action-bar">
        <!--
          行1 = 输入 + 发表（flex 兄弟，不是绝对定位覆盖）。
          输入框 flex:1 吃掉剩余宽度，按钮 flex:0 保住热区，
          两者**不重叠** —— 这正是 P21 踩过的那个坑的正解。
        -->
        <div class="bar-row">
          <div class="bar-input">
          <div v-if="replyTarget" class="replying" data-test="comment-replying">
            回复 @{{ replyTarget.nickname }}
            <button type="button" data-test="comment-cancel-reply" @click="cancelReply">取消</button>
          </div>
          <!--
            P29：输入 @ 弹候选选择器。
            ⚠️ keydown 必须**手动转发**给选择器 —— textarea 会吞掉 Enter/Tab，
            冒泡到根上的监听器拿不到它们，所以「在候选里按回车选中」会失效。
            ⌘/Ctrl+Enter 仍然直接发（是发表，不是选择）。
          -->
          <textarea
            v-model="draft"
            class="c-input"
            rows="1"
            :maxlength="COMMENT_MAX + 50"
            :placeholder="draftPlaceholder"
            :aria-label="replyTarget ? `回复 @${replyTarget.nickname}` : '发表评论'"
            data-test="comment-input"
@input="mention.onDraftInput"
            @keydown="onDraftKeydown"
            @blur="mention.onDraftBlur"
            @click="mention.syncCaret"
            @keyup="mention.syncCaret"
          />
          <!--
            挂在这层（position:relative）而不是 body：面板要贴着输入框上方，
            挂到 body 就得自己算坐标，而输入框会随 ResizeObserver 长高。
          -->
          <MentionPicker
            v-if="mention.showMentionPicker"
            ref="mention.mentionPickerRef"
            :text="draft"
            :caret="mention.caret.value"
            @pick="mention.applyMention"
          />
          <div v-if="showLen" class="c-len" :class="{ over: draftOver }" data-test="comment-len">
            {{ draftLen }}/{{ COMMENT_MAX }}
          </div>
        </div>

          <!--
            发表按钮**重新挪回输入框右侧**（用户反馈 2026-10-11）。
            ⚠️ P21 曾经特意把它搬进行2，理由是它原来**绝对定位**压在胶囊
            右下角，只靠 padding-right: 56px 让位，而 56px 恰好等于按钮
            宽度 —— textarea 超过 max-height 内部滚动后，滚出来的行直接
            走到按钮底下（"输入时遮挡"）。

            这次的问题是**摆放方式**而不是摆放位置：改成 flex 兄弟节点后
            （输入 flex:1、按钮 flex:0），胶囊自动收窄、两者根本不重叠，
            P21 那个 bug 从根上不存在。而写在输入框右边也符合直觉 ——
            "写完顺手点发送"是大多数人的动作顺序。

            可见文字「发送」而不是纯图标：图标看不出这是什么按钮。
          -->
          <button
            class="c-send"
            type="button"
            :disabled="!canSubmit"
            aria-label="发表评论"
            title="发表评论"
            data-test="comment-submit"
            @click="submitComment"
          >
            发送
          </button>
        </div>

        <!-- 行2 = 三键（赞 / 藏 / 评），贴右缘 -->
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
        <!-- /.col-media -->

        <!-- ================= 右栏：作者 / 标题+正文 ================= -->
        <!--
          作者区在标题**上方**、标题与正文紧挨着（用户要求：用户信息在最上面，
          标题应该和文章一起）。别再把 .who 塞回标题和正文中间。
        -->
        <div class="col-text">
          <div class="who">
            <UserAvatar :avatar="note.authorAvatar" :nickname="note.authorNickname" :size="34" test="note-avatar" />
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
            ><template
              v-for="(seg, i) in mentionNodes(note.content, note.mentions)"
              :key="i"
            ><RouterLink
              v-if="seg.userId"
              class="mention"
              data-test="note-mention"
              :to="'/user/' + seg.userId"
            >{{ seg.text }}</RouterLink><template v-else>{{ seg.text }}</template></template></p>

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

          <!--
            话题 chip。正文里的 #话题 是唯一事实来源，这些 chip 是后端解析完回传的，
            所以它们**总是**与正文一致 —— 前端不再自己扫一遍正文做高亮，
            那种「两套正则」迟早对不上（发布页的预览就是另一处正则，见 noteTopics）。
          -->
          <ul v-if="note.topics?.length" class="topics" data-test="note-topics">
            <li v-for="tp in note.topics" :key="tp.id">
              <RouterLink
                class="chip"
                data-test="note-topic"
                :to="'/topic/' + encodeURIComponent(tp.name)"
              >
                #{{ tp.name }}
              </RouterLink>
            </li>
          </ul>

          <!--
            「谁赞了 / 谁收藏了」的入口。

            刻意**没有**把它做成吸底三键的一部分：三键是「点了就切换状态」的动作按钮，
            再塞一个「点了就跳页」的行为进去，同一个控件两种语义，键盘和读屏都讲不清
            （aria-pressed 和导航互斥）。所以另外起一行文字链接，仍然显示真实计数。
            计数为 0 时整行不渲染 —— 「0 人赞过」没人想点。
          -->
          <p v-if="note.likeCount > 0 || note.collectCount > 0" class="interacts">
            <RouterLink
              v-if="note.likeCount > 0"
              class="ilink"
              data-test="note-likes-link"
              :to="`/note/${note.id}/likes`"
            >
              {{ note.likeCount }} 人赞过
            </RouterLink>
            <RouterLink
              v-if="note.collectCount > 0"
              class="ilink"
              data-test="note-collects-link"
              :to="`/note/${note.id}/collects`"
            >
              {{ note.collectCount }} 人收藏过
            </RouterLink>
          </p>
        </div>
        <!-- /.col-text -->
    </article>

    <!--
      P51：面板底部的上/下篇切换（小红书 explore 面板的 ← → 的可见形态）。
      当前不在推荐流里（自己发的 / 私密）时整条不渲染 —— railIdx=-1 时
      「上篇」指向谁没有定义，不装作有。
      移动端 <1024 同样隐藏（手机的上滑切换是 P52）。
    -->
    <nav
      v-if="railIdx >= 0 && (prevRail || nextRail)"
      class="pane-nav"
      data-test="detail-pane-nav"
      aria-label="上下篇"
    >
      <button
        type="button"
        :disabled="!prevRail"
        data-test="detail-pane-prev"
        @click="prevRail && goRailNote(prevRail.id)"
      >
        ‹ 上篇
      </button>
      <span class="pane-count" data-test="detail-pane-count">
        {{ railIdx + 1 }} / {{ railNotes.length }}
      </span>
      <button
        type="button"
        :disabled="!nextRail"
        data-test="detail-pane-next"
        @click="nextRail && goRailNote(nextRail.id)"
      >
        下篇 ›
      </button>
    </nav>

    <!--
      P52：移动端上滑/下滑的提示药丸。跟手 peek 时淡入并升起，
      松手回弹淡出。pointer-events:none —— 只是提示，不拦任何点击；
      它自身有 transform（水平居中+升起），fixed 元素自身带 transform 无害
      （包含块问题是祖先链的事）。
    -->
    <div
      v-if="swipeDir && swipeHintText"
      class="swipe-hint"
      data-test="swipe-hint"
      :style="{ '--hint-rise': `${swipePeek * 0.4}px` }"
      aria-hidden="true"
    >
      <span class="swipe-hint-arrow">{{ swipeDir === 'prev' ? '↓' : '↑' }}</span>
      <span class="swipe-hint-t">{{ swipeHintText }}</span>
    </div>
  </main>
</template>

<style scoped>
/*
 * 管理员只读视角的提示条（P42）。
 * ⚠️ 必须**显眼**：普通用户看不到已下架的笔记，
 * 而管理员看得到 —— 不说清楚，运营会以为这是所有人都能看到的内容。
 */
.admin-note {
  margin: 0 0 var(--xk-space-3);
  padding: var(--xk-space-3) var(--xk-space-4);
  border: var(--xk-stroke-w) solid var(--xk-amber-text);
  border-radius: var(--xk-radius-blob-sm);
  background: color-mix(in srgb, var(--xk-amber) 12%, transparent);
  color: var(--xk-text);
  font-size: var(--xk-fs-13);
  line-height: 1.6;
}
.admin-note strong { color: var(--xk-amber-text); }

/* 视频播放器（P48）：VideoPlayer 组件自带描边/圆角/进度条，
   这里只剩外距；比例的 --img-ratio 由 <article> 统一给（视频元数据上报后跟着视频形状走） */
.videobox {
  margin-bottom: 12px;
}
/* 话题 chip：横排可换行，琥珀描边（品牌色里最弱的一档，不抢正文注意力） */
.topics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  color: var(--xk-amber-text);
  font-size: var(--xk-fs-13);
  text-decoration: none;
}

.chip:hover {
  border-color: var(--xk-amber);
  background: var(--xk-surface-2);
}

/* @提及：正文里的可点片段。只用下划线不换色 —— 正文是大块阅读，
   一处标记就够，再上颜色会让人以为标错了 */
.mention {
  color: var(--xk-amber-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/*
 * 「N 人赞过 · N 人收藏过」这一行。
 *
 * 排版取舍：走 --xk-text-3（meta 色）而不是正文色 —— 它是次要入口，
 * 正文色的对比度预算要留给正文；但字号给到 14px 而不是 meta 常用的 12px，
 * 因为它是要点的（热区 40px，见 web-interface-guidelines）。
 */
.interacts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 10px 0 0;
}

.ilink {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-14);
  text-decoration: none;
  cursor: pointer;
}

.ilink:hover {
  color: var(--xk-amber-text);
}

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

/* ==================== P49：视频笔记移动端沉浸式 ====================
 * 对齐小红书的视频页：黑底满宽、顶栏浮层、白字正文。
 *
 * 三个措施，只对「有 videoUrl 的这篇笔记」生效（图文笔记一个像素都不动）：
 * ① 字色系整体换白 —— 在作用域里重定义 var()（--xk-text/-2/-3、
 *    --xk-surface/-2、--xk-border、--xk-amber-text、--xk-bg），靠继承
 *    一次到达所有后代（评论行 / 话题 chip / 点赞行 / 操作栏 / Vant 底色）。
 *    反过来逐个选择器覆盖是 14 处起步，迟早漏一处出现「黑底黑字」。
 * ② 正文顶到屏幕上沿：.top 从流里拿走改 fixed 浮层（黑渐变托白字）。
 * ③ 卡片外壳（描边/圆角/内边距/硬阴影）在黑底里失去意义，全下。
 */
@media (max-width: 1023px) {
  .page.immerse {
    padding-top: 0;
    padding-left: 0;
    padding-right: 0; /* ≈ 负 margin，但不用算断点差异，768 段的左右 24px 一并归零 */
    /* color 必须在这里显式设：全站文字的颜色是 body { color: var(--xk-text) }
       沿 DOM 继承下来的，标题/正文/昵称根本没有自己的 color 规则 ——
       只重定义变量不会让 body 换值，必须在这个作用域里开新的继承起点 */
    color: var(--xk-text);
    --xk-text: #f2f2f5;
    --xk-text-2: #cfccd6;
    --xk-text-3: #9d99a6;
    --xk-bg: #0d0d10;
    --xk-surface: #0d0d10;
    --xk-surface-2: rgba(255, 255, 255, 0.07);
    --xk-border: rgba(255, 255, 255, 0.16);
    --xk-amber-text: #f5cd7a;
  }

  /* 整个视口黑。html 上的规则必须在 scoped 里用 :global 包：
     data-v 属性只打在本组件模板内的元素上，html/body 永远没有它，
     不用 :global 的话这条选择器永远匹配不到 —— 静默失效，不报错。 */
  :global(html:has(.page.immerse)) {
    --xk-bg: #0d0d10;
  }

  /* 顶栏浮到视频上。fixed 脱流后正文才能顶到 0；渐变托底保证白字可读 */
  .page.immerse > .top {
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 480px;
    box-sizing: border-box;
    z-index: 50;
    padding: calc(var(--xk-space-2) + env(safe-area-inset-top, 0px))
      var(--xk-space-4) var(--xk-space-2);
    background: linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0));
  }

  .page.immerse .card {
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }

  .page.immerse .videobox {
    margin: 0;
  }

  /* VideoPlayer 的外壳是子组件自己的 scoped 规则，父侧要 :deep 穿透 */
  .page.immerse .videobox :deep(.vp) {
    border: 0;
    border-radius: 0;
  }

  .page.immerse .videobox :deep(.vp-video) {
    max-height: none;
  }

  /* .page 左右 padding 已归零。注释里要写清：.col-text 移动端是
     display:contents（不生成盒子），padding 挂它身上是静默 no-op ——
     所以左右留白必须兜在每一个真实子元素上（who/title/content/
     expand/topics/interacts）。.comments 自己有盒，可以直接挂。 */
  .page.immerse .col-text > * {
    padding-left: var(--xk-space-4);
    padding-right: var(--xk-space-4);
  }

  .page.immerse .comments {
    padding-left: var(--xk-space-4);
    padding-right: var(--xk-space-4);
  }

  /* 视频下缘一条黑晕，让作者区「浮」进视频的收尾里 */
  .page.immerse .col-text .who {
    margin-top: calc(var(--xk-space-2) * -1);
  }
}

/* ==================== P49：视频笔记桌面端两栏（修补後） ====================
 * P49-A 把 `.card:not(:has(.grid, .videobox))` 的单栏兜底从视频笔记手里拿走后，
 * 视频笔记回到与图文相同的三件套网格。这里只做一件补偿：竖屏视频按
 * 「高 = 72vh × 宽高比」收窄左栏宽度，不让 440px 的列宽把它上下裁切
 * （比列窄是视频自己的形状，比黑边补丁干净）。
 */
@media (min-width: 1024px) {
  .card.has-video .videobox {
    width: calc(72vh * var(--img-ratio, 0.5625));
    max-width: var(--xk-col1);
  }
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

  /* 没有任何媒体（改图后清空等）退回单栏居中，不留一整片空白左栏。
     P49：判据必须是「grid 或 videobox」——视频笔记没有 .grid，
     只判 grid 会把视频笔记也误判成无媒体，整篇塌进 620px 单栏（右栏消失，
     桌面截图里只剩 324px 窄视频）。 */
  .card:not(:has(.grid, .videobox)) {
    grid-template-columns: minmax(0, 1fr);
    max-width: var(--xk-col1-narrow);
    margin: 0 auto;
  }

  .card:not(:has(.grid, .videobox)) .col-media,
  .card:not(:has(.grid, .videobox)) .col-text {
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
  /*
    `bottom: var(--kb-inset)` 而不是把键盘高度塞进 padding —— 2026-10-04 改。
    原来 padding-bottom 吃掉了 --kb-inset，于是：
      ① `--bar-h` 是 ResizeObserver 量 offsetHeight 得到的，**已经包含键盘高度**，
         而 .page 的 `padding-bottom: calc(var(--bar-h) + var(--kb-inset))` 又加一遍
         → 键盘一开页面末尾就有约 2 倍键盘高度的死空白；
      ② 栏本身被撑成「键盘高 + 112px」，靠那截空白把内容顶到键盘上方 ——
         位置碰巧对，机制是错的。
    现在键盘高度只用来**抬栏**，两条路径自然不重复：
      Android（viewport meta 的 interactive-widget=resizes-content）layout viewport
        自己收缩 → `visualViewport.height ≈ innerHeight` → inset 算出来是 0
        → bottom:0 正好落在视口底 = 键盘上方；
      iOS Safari 不缩 → inset = 键盘高度 → bottom 抬到键盘上方。
    桌面（≥1024）本规则被 `position: static` 覆盖，bottom 不生效。
    env(safe-area-inset-bottom) 是补上的：TabBar 与 .page 一直有，吸底栏漏了，
    刘海屏上键盘收起时按钮会压到 Home 指示条。
  */
  bottom: var(--kb-inset, 0px);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: var(--xk-space-2);
  padding: var(--xk-space-2) var(--xk-space-3)
    calc(var(--xk-space-2) + env(safe-area-inset-bottom, 0px));
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
  /* ⚠️ P30 补：@ 候选面板是 position:absolute，它需要一个定位参照系。
   * 漏了这一行，参照系会一路上浮 —— 桌面端 .actionbar 是 position:static
   * （P25 撤掉吸底壳），于是面板的参照系落到**初始包含块（整个视口）**，
   * `bottom: calc(100% + 4px)` 把它推到视口顶边之外，**完全看不见**。
   * 症状是「DOM 里有这个元素、CDP 断言全绿、用户就是看不到」——
   * 而那条 CDP 断言当时只查了 querySelector 存不存在。 */
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0; /* flex 内 textarea 溢出（SiteNav 搜索框前科） */
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
 * 行1：输入 + 发表，两个 flex 兄弟。
 * 输入 flex:1 吃掉剩余宽度、min-width:0 防止 flex 内 textarea 溢出
 * （SiteNav 搜索框前科），按钮 flex:0 保住热区 —— 两者不重叠。
 */
.bar-row {
  display: flex;
  align-items: flex-end;
  gap: var(--xk-space-2);
}

.bar-input {
  flex: 1 1 auto;
  min-width: 0;
}

/*
 * 发送是**动作**不是导航 → button。
 * 可见文字「发送」而不是纯图标（用户反馈：图标看不出这是什么）。
 * 配色用品牌 token：旧版硬编码 #f5a623 底 + 白字 = 2.03:1（AA 要 4.5），
 * --xk-amber 底 + --xk-amber-ink 字是 9.69:1，与 .xk-btn 同一套。
 * 高度 44 与输入胶囊同高，两者底边齐平。
 */
.c-send {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 var(--xk-space-4);
  border: 0;
  border-radius: 999px;
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font: inherit;
  font-size: var(--xk-fs-15);
  font-weight: 600;
  white-space: nowrap;
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
  /* 行2 只剩三键，贴右缘（与输入框右缘对齐） */
  align-self: flex-end;
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

/*
 * P45：被定位到的那条评论（?comment=xxx）高亮。
 *
 * ⚠️ 高亮的是**评论本身**，不是整个卡片 —— 一条评论在一大列里，
 * 整块高亮会让人以为整段评论区都被选中了。
 * 用左边框 + 浅底，不只靠颜色（a11y 的「不只靠单一感官通道」）。
 */
.c-item.hit,
.c-reply.hit {
  border-left: 3px solid var(--xk-amber);
  background: color-mix(in srgb, var(--xk-amber) 10%, transparent);
  border-radius: 0 var(--xk-radius-blob-sm) var(--xk-radius-blob-sm) 0;
  padding-left: 8px;
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

/* ==================== P51：PC 弹出面板（左瀑布 + 右面板 + ←→ 上下篇） ==================== */

/* 移动端（<1024）两个新元素都不存在 —— 上滑切换是 P52 的事 */
.rail,
.pane-nav {
  display: none;
}

.rail-hint {
  margin: 0;
  padding: 24px 0;
  text-align: center;
  font-size: var(--xk-fs-13);
  color: var(--xk-text-3);
}

@media (min-width: 1024px) {
  /*
   * 外壳：左瀑布 sticky 内滚 + 右面板随页面滚。
   * ⚠️ 特异性是**主动利用** P12-C 记过的那条规则：scoped 的
   * .note-detail-page[data-v]（0,2,0）压过 main.css 的 .page（0,1,0），
   * max-width 才真正放开 —— 全宽是小红书 explore 的形状，同时
   * rail 才装得下两列瀑布。
   */
  .note-detail-page {
    max-width: none;
    display: grid;
    grid-template-columns: minmax(220px, 340px) minmax(0, 1fr);
    column-gap: var(--xk-space-5);
    align-items: start;
  }

  /* 顶栏/错误提示/卡片/上下篇 —— 全部进右列，现有选择器一个不动 */
  .note-detail-page > :not(.rail) {
    grid-column: 2;
  }

  .rail {
    display: block;
    grid-column: 1;
    grid-row: 1 / span 40;
    position: sticky;
    top: calc(var(--xk-sitenav-h, 0px) + 12px);
    align-self: start;
    max-height: calc(100vh - var(--xk-sitenav-h, 0px) - 24px);
    overflow-y: auto;
  }

  .rail-cols {
    columns: 2;
    column-gap: 10px;
  }

  .rail-item {
    display: block;
    break-inside: avoid;
    margin: 0 0 10px;
    border-radius: var(--xk-radius-blob-sm);
    overflow: hidden;
    background: var(--xk-surface-2);
    color: var(--xk-text);
    text-decoration: none;
    border: 1px solid transparent;
  }

  .rail-item:hover {
    border-color: var(--xk-border);
  }

  /* 当前卡：描边 + 不只靠颜色（aria-current 同步给了读屏） */
  .rail-item.cur {
    border-color: var(--xk-amber);
    box-shadow: inset 0 0 0 1px var(--xk-amber);
  }

  .rail-cover {
    display: block;
    width: 100%;
    aspect-ratio: 3 / 4;
    object-fit: cover;
    background: var(--xk-surface-2);
  }

  .rail-title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding: 6px 8px;
    font-size: var(--xk-fs-12);
    font-weight: 600;
    line-height: 1.4;
    word-break: break-word;
  }

  .pane-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--xk-space-3);
    margin: var(--xk-space-4) 0 0;
  }

  .pane-nav button {
    min-height: 40px;
    padding: 0 var(--xk-space-4);
    border: var(--xk-stroke-w) solid var(--xk-border);
    border-radius: 999px;
    background: var(--xk-surface-2);
    color: var(--xk-text);
    font-size: var(--xk-fs-13);
    cursor: pointer;
  }

  .pane-nav button:hover:not(:disabled) {
    border-color: var(--xk-amber);
    color: var(--xk-amber-text);
  }

  .pane-nav button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .pane-count {
    min-width: 56px;
    text-align: center;
    font-size: var(--xk-fs-13);
    color: var(--xk-text-3);
    font-variant-numeric: tabular-nums;
  }
}

/* ==================== P52：移动端上滑切下一条 / 下滑切上一篇 ==================== */

@media (max-width: 1023px) {
  /*
   * ⚠️ card 的基础规则**只**过渡 opacity —— transform 绝不能常驻：
   * 吸底操作栏（action-bar）是 card 的子元素且 position:fixed，
   * card 一旦有非 none 的 transform，它的 fixed 包含块就从视口变成
   * card，吸底当场失效。transform 只在 leave 与 enter 类存在的
   * 动画窗口里出现，撤类即还给视口。
   */
  .card {
    transition: opacity 200ms ease;
  }
  .card.dim {
    opacity: 0.92;
  }

  /* 出场：滑走。底栏以 card 为包含块，跟着一起滑走 = 整页滑的观感 */
  .card.leave-next {
    transform: translateY(-45vh);
    opacity: 0.35;
    transition: transform 200ms cubic-bezier(0.32, 0.72, 0.34, 1), opacity 200ms ease;
  }
  .card.leave-prev {
    transform: translateY(45vh);
    opacity: 0.35;
    transition: transform 200ms cubic-bezier(0.32, 0.72, 0.34, 1), opacity 200ms ease;
  }

  /* 入场：pre 态无过渡直接落位（挂在 replace 前，首帧就位不闪） */
  .card.enter-pre {
    transform: translateY(0);
    opacity: 0;
    transition: none;
  }
  .card.enter-pre.from-below {
    transform: translateY(56px);
  }
  .card.enter-pre.from-above {
    transform: translateY(-56px);
  }
  /* run 态：从 pre 的 56px/0 过渡回 0/1 */
  .card.enter-run {
    transform: translateY(0);
    transition: transform 220ms cubic-bezier(0.22, 0.9, 0.36, 1), opacity 220ms ease;
  }
}

/* 提示药丸：自身 transform（居中 + 跟手升起）——fixed 元素自身带 transform 无害 */
.swipe-hint {
  position: fixed;
  left: 50%;
  bottom: calc(var(--bar-h, 112px) + 20px);
  transform: translate(-50%, calc(var(--hint-rise, 0px) * -1));
  z-index: 58;
  pointer-events: none;
  max-width: calc(100% - 48px);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  white-space: nowrap;
}
.swipe-hint-arrow {
  color: var(--xk-amber-text);
  font-weight: 700;
}
.swipe-hint-t {
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .card.leave-next,
  .card.leave-prev,
  .card.enter-pre,
  .card.enter-run {
    transition: none !important;
  }
}
</style>
