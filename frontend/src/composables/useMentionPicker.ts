import { nextTick, ref } from 'vue'
import type MentionPicker from '@/components/MentionPicker.vue'

/**
 * 把「@ 提及候选选择器」接到任意一个 textarea 上（P29 引入 / P30 改造）
 *
 * <p><b>为什么抽成 composable 而不是复制两份</b>：发布页与评论区要的行为
 * 完全一样（光标同步、@ 触发、Enter 选中、替换而非追加）。复制两份的必然
 * 结果是一处改了另一处没改，而症状是「发布页能选中、评论区不能」——
 * 没有报错，纯粹靠人发现。
 *
 * <p><b>为什么 textarea 会吞掉 Enter / Tab</b>：它们在 textarea 里是
 * 「换行 / 移焦点」，**不冒泡**到祖先元素。所以「候选开着时按回车选中」
 * 必须在 textarea 自己的 keydown 里处理 —— 这也是本 composable 返回
 * `onKeydown` 而不是让调用方在根节点监听的原因。
 *
 * <p><b>替换而不是追加</b>：用户已经打了 `@关`，选中后要写成 `@关注搭子`；
 * 追加会得到 `@关@关注搭子`，用户看到的是两个 @。
 *
 * ==================== P30：正文只是外观，id 才是事实 ====================
 *
 * <p>昵称**允许重复**，所以服务端解析文本就必须在重名时挑一个，而挑错人
 * 比不 @ 更糟（通知发给了完全无关的人）。小红书的做法是**选人那一刻
 * userId 就定了**，正文里的 `@昵称` 只是给人看的装饰。我们对齐这一点：
 *
 * <ul>
 *   <li>选中候选 → 正文插 `@昵称`（人看的，不是拉丁用户名）</li>
 *   <li>同时记下这个人的 {id, text}，提交时一起发给后端</li>
 *   <li>提交前**过滤掉正文里已经被删掉的那段** —— 用户把 `@昵称` 删了
 *       就不会误发提及，不需要额外的「撤销 @」UI</li>
 * </ul>
 *
 * <p>代价：手打 `@昵称` 不会产生提及。`unresolvedMentions()` 就是为这个
 * 存在的 —— 把「没生效」变成一句明确的话，而不是静默失败。
 */
export function useMentionPicker(model: { value: string }, selector: string) {
  const caret = ref(0)
  const showMentionPicker = ref(false)
  const mentionPickerRef = ref<InstanceType<typeof MentionPicker> | null>(null)

  /** 已选中的人。`at` = 这段 @ 在正文里的起始下标 */
  const picked = ref<{ id: string; text: string; at: number }[]>([])

  function syncCaret(e: Event) {
    const el = e.target as HTMLTextAreaElement | null
    if (el) caret.value = el.selectionStart ?? model.value.length
  }

  function onDraftInput(e: Event) {
    syncCaret(e)
    // ⚠️ 这里**刻意不做**任何剪枝：靠文本比对无法区分「我插的那段」与
    // 「用户手打的同样文字」，两种情况下正文里都找得到这个昵称
    // （P30 实测：剪枝写了却不生效，请求体里 mentionUserIds 仍非空）。
    // 真正的核对放在 mentionUserIds()，那里有插入时记下的**位置**。
    //
    // 显隐由 MentionPicker 内部的 query 决定，这里只是把它挂上。
    // ⚠️ **不能**在 query 为 null 时置 false：textarea 失焦再回来、
    // 或用户删掉 @ 之后，选择器自己的 close 事件会更快到达；
    // 两侧都管会互相打架，出现「面板关不掉」。
    showMentionPicker.value = true
  }

  function onDraftBlur() {
    // mousedown 选中候选与 blur 的先后顺序在不同浏览器里不一致，
    // 延后一拍让两者都跑完
    setTimeout(() => { showMentionPicker.value = false }, 120)
  }

  function applyMention(user: { id: string; text: string }) {
    const before = model.value.slice(0, caret.value)
    const m = /@([^\s@]*)$/.exec(before)
    const head = m ? before.slice(0, before.length - m[0].length) : before
    const tail = model.value.slice(caret.value)
    const ins = `@${user.text} `
    model.value = head + ins + tail
    showMentionPicker.value = false
    // 同一人重复 @ 不重复记 —— 关系行有唯一索引，重复记反而会让
    // 「未生效提示」把第一次的 @ 误报成没生效
    if (!picked.value.some((p) => p.id === user.id)) {
      picked.value.push({ id: user.id, text: user.text, at: head.length })
    }
    nextTick(() => {
      const el = document.querySelector<HTMLTextAreaElement>(selector)
      if (!el) return
      const pos = (head + ins).length
      el.focus()
      el.setSelectionRange(pos, pos)
      caret.value = pos
    })
  }

  /** 提交用：只有**我亲手插的那一段还在原位**才算数 */
  function mentionUserIds(): string[] {
    const live = model.value
    // ⚠️ 靠「正文里还有 @昵称」判断是**不够的**（P30 实测踩到）：
    // 用户先用候选选了「互动搭子」，随后把那段删掉、**又手打了一遍同样的字**。
    // 纯文本过滤会把**手打的那次**也算成提及成功 —— 请求体里
    // mentionUserIds 非空，从外面完全看不出问题；而用户看到的是
    // 「明明是手打的，对方却收到了通知」。
    //
    // 改成**按下标核对**：插入时记下位置，提交时确认那个位置上仍然是
    // 我插入的那一段。用户删掉重打，位置上的内容就变了 → 记录失效。
    picked.value = picked.value.filter((p) => {
      const seg = live.slice(p.at, p.at + p.text.length + 1)
      return seg === '@' + p.text
    })
    return picked.value.map((p) => p.id)
  }

  /**
   * 正文里打了 @ 但**没被选中**的那些词（用于发完后的明确提示）
   *
   * <p>切词规则与 {@code NoteDetailView.mentionNodes} 必须一致，否则会
   * 出现「明明 @ 到了却被告知没 @ 到」。
   */
  function unresolvedMentions(effective: { nickname?: string; username?: string }[]): string[] {
    const known = new Set<string>()
    for (const m of effective) {
      if (m.nickname) known.add(m.nickname)
      if (m.username) known.add(m.username)
    }
    const out: string[] = []
    const re = /@([^\s@]{1,32})/g
    for (let mt = re.exec(model.value); mt; mt = re.exec(model.value)) {
      const token = mt[1]
      if (known.has(token)) continue
      // ⚠️ **不能**因为「picked 里有这个词」就算生效：用户可能选了候选之后
      // 又把它删掉、手打了同样的字。那种情况下这条 id 会在提交时被位置核对
      // 剔除（mentionUserIds），这里若放行就会**误报**「你 @ 到了人」，
      // 而实际没 @ 到 —— 提示反而成了假绿。
      if (!out.includes(token)) out.push(token)
    }
    return out
  }

  /** 切换账号 / 清空草稿时要把已选记录一起清掉，否则会带着上一条评论的 id */
  function resetPicked() {
    picked.value = []
  }

  /**
   * textarea 的 keydown 转发器
   *
   * @param onSubmit ⌘/Ctrl+Enter 时要执行的动作（发表/回复）
   * @returns true = 这个键已被消费（调用方要 preventDefault）
   */
  function onDraftKeydown(e: KeyboardEvent, onSubmit?: () => void) {
    if (mentionPickerRef.value?.onKey(e)) {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onSubmit?.()
      return true
    }
    return false
  }

  return {
    caret,
    showMentionPicker,
    mentionPickerRef,
    syncCaret,
    onDraftInput,
    onDraftBlur,
    applyMention,
    onDraftKeydown,
    mentionUserIds,
    unresolvedMentions,
    resetPicked,
  }
}