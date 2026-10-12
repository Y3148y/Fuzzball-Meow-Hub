import { nextTick, ref } from 'vue'
import type MentionPicker from '@/components/MentionPicker.vue'

/**
 * 把「@ 提及候选选择器」接到任意一个 textarea 上（P29）
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
 * <p><b>替换而不是追加</b>：用户已经打了 `@关`，选中后要写成 `@xk_ui_follow`；
 * 追加会得到 `@关@xk_ui_follow`，服务端解析出的用户名是「关」。
 */
export function useMentionPicker(model: { value: string }, selector: string) {
  const caret = ref(0)
  const showMentionPicker = ref(false)
  const mentionPickerRef = ref<InstanceType<typeof MentionPicker> | null>(null)

  function syncCaret(e: Event) {
    const el = e.target as HTMLTextAreaElement | null
    if (el) caret.value = el.selectionStart ?? model.value.length
  }

  function onDraftInput(e: Event) {
    syncCaret(e)
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

  function applyMention(username: string) {
    const before = model.value.slice(0, caret.value)
    const m = /@([^\s@]*)$/.exec(before)
    const head = m ? before.slice(0, before.length - m[0].length) : before
    const tail = model.value.slice(caret.value)
    const ins = `@${username} `
    model.value = head + ins + tail
    showMentionPicker.value = false
    nextTick(() => {
      const el = document.querySelector<HTMLTextAreaElement>(selector)
      if (!el) return
      const pos = (head + ins).length
      el.focus()
      el.setSelectionRange(pos, pos)
      caret.value = pos
    })
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
  }
}