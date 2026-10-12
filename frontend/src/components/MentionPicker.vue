<script setup lang="ts">
/**
 * 「@ 提及」候选选择器（P29）
 *
 * <p><b>为什么必须有它</b>：@ 提及要求知道对方的**用户名**（拉丁字符），
 * 而界面上到处显示的是**昵称**。用户看得见「关注搭子」，却要手打
 * `xk_ui_follow` —— 这就是立项时那条反馈的原话：「@ 什么都没���，
 * 没有候选列表」「我只能看到昵称，只能在主页看到用户名」。
 *
 * <p><b>为什么搜昵称也搜得到、插入的却是用户名</b>：用户名唯一、昵称不唯一，
 * 所以正文里必须写用户名；但搜索两个都匹配，用户想「按昵称找人」也能找��。
 *
 * <p>不做富文本编辑器：这个组件只在光标处插一段纯文本 `@username`，
 * 与已有的 `MENTION_RE` 解析天然对得上。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { searchMentionUsers } from '@/api/search'
import type { UserPickVO } from '@/api/types'

const props = defineProps<{
  /** 当前输入框的完整文本 */
  text: string
  /** 光标位置（textarea 的 selectionStart） */
  caret: number
}>()
/**
 * 选中时把 **id 和要插入的文字**一起抛出去（P30）
 *
 * <p>为什么插入昵称而不是用户名：用户名从此不再展示给用户（决策），
 * 用户输入框里出现 `@xk_ui_follow` 本身就是一种暴露。
 *
 * <p>为什么必须带 id：昵称允许重复，服务端解析文本就得在重名时挑一个，
 * 而挑错人比不 @ 更糟。**正文只是外观，id 才是事实。**
 */
const emit = defineEmits<{
  (e: 'pick', user: { id: string; text: string }): void
  (e: 'close'): void
}>()

const candidates = ref<UserPickVO[]>([])
const loading = ref(false)
const active = ref(0)
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
let lastPickAt = 0

/**
 * 同一次「点」只选中一次，但 **mousedown 与 click 都要接**。
 *
 * <p>只用 mousedown：抢在 blur 之前（否则面板先收起、点不到），
 * 但**读屏软件与 {@code el.click()} 只派发 click**，那时功能整个失效 ——
 * 症状是「鼠标点得好好的，键盘/读屏用户选不了」。
 *
 * <p>只用 click：blur 先于 click，面板已经没了。
 *
 * <p>两个都绑 + 一个 400ms 去重窗口：真实鼠标会依次触发 mousedown 与
 * click，第二次被窗口挡掉；读屏只触发 click，第一次正常生效。
 */
function pickOnce(u: UserPickVO) {
  const now = Date.now()
  if (now - lastPickAt < 400) return
  lastPickAt = now
  pick(u)
}

/**
 * 触发词 = 光标前最近一个未被空白截断的 @片段
 *
 * <p>没有用「最后一个 @」这么简单的规则：正文里写了
 * `a@b.com 顺便 @关` 时，最后一个 @ 才是用户正在输入的那个，
 * 而 `b.com` 里的 @ 不是。限定「@ 后不能有空白」就自然排除了邮箱。
 */
const query = computed(() => {
  const head = props.text.slice(0, props.caret)
  const m = /@([^\s@]*)$/.exec(head)
  return m ? m[1] : null
})

async function fetchCandidates(kw: string) {
  const my = ++seq
  loading.value = true
  try {
    // request.ts 的 get<T> 已经拆掉了外层 Result，这里拿到的是**裸数组**
    //（不是 { data: [...] }）—— 与其余 api/*.ts 的用法一致
    const rows = await searchMentionUsers(kw, 8)
    if (my !== seq) return          // 慢请求回来时已经被更新的输入取代
    candidates.value = rows ?? []
    active.value = 0
  } catch {
    // 搜索失败就当没有候选：选择器是增强功能，不该因为它坏了挡住用户写评论
    if (my === seq) candidates.value = []
  } finally {
    if (my === seq) loading.value = false
  }
}

watch(query, (kw) => {
  clearTimeout(timer)
  if (kw === null) {
    candidates.value = []
    emit('close')
    return
  }
  // 200ms 防抖：后端这个接口限流 40/min，而每敲一个字符都会触发一次
  timer = setTimeout(() => fetchCandidates(kw), 200)
}, { immediate: true })

function move(delta: number) {
  if (!candidates.value.length) return
  active.value = (active.value + delta + candidates.value.length) % candidates.value.length
}

function pick(u: UserPickVO) {
  emit('pick', { id: String(u.id), text: u.nickname })
}

function onKey(e: KeyboardEvent): boolean {
  if (!candidates.value.length) return false
  if (e.key === 'ArrowDown') { move(1); return true }
  if (e.key === 'ArrowUp') { move(-1); return true }
  if (e.key === 'Enter' || e.key === 'Tab') {
    pick(candidates.value[active.value])
    return true
  }
  if (e.key === 'Escape') {
    emit('close')
    return true
  }
  return false
}

defineExpose({ onKey })

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div v-if="candidates.length" class="picker" data-test="mention-picker" role="listbox" aria-label="@ 提及候选">
    <button
      v-for="(u, i) in candidates"
      :key="u.id"
      type="button"
      class="opt"
      :class="{ on: i === active }"
      role="option"
      :aria-selected="i === active"
      :data-test="'mention-opt-' + u.username"
      @mousedown.prevent="pickOnce(u)"
      @click="pickOnce(u)"
      @mouseenter="active = i"
    >
      <img v-if="u.avatar" class="av" :src="u.avatar" :alt="`${u.nickname} 的头像`" width="28" height="28" />
      <span v-else class="av av-ph" aria-hidden="true" />
      <span class="nm">{{ u.nickname }}</span>
      <!--
        P30：这里原来有一行灰色的 @用户名。
        **刻意去掉** —— 用户名从此不再展示给人看（决策：username 退回为
        纯登录标识）。留着它会让用户在选人时又看见那个「要记住的名字」，
        与 P30 的目的正好相反。
      -->
    </button>
  </div>
</template>

<style scoped>
/*
  用 .picker 而不是 Vant 的 Popup/Picker：候选面板只有几行、需要在输入框上方
  贴着弹，而且 Esc/Enter 的行为要交给宿主的 keydown 统一处理
  （textarea 里也监听同一个事件）。塞进浮层组件反而要多绕一层事件转发。
*/
.picker {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 4px);
  z-index: 70;
  max-height: 264px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--xk-space-1);
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob);
  background: var(--xk-surface);
  box-shadow: var(--xk-shadow-soft);
}

.opt {
  display: flex;
  align-items: center;
  gap: var(--xk-space-2);
  width: 100%;
  min-height: 44px;          /* P13 热区下限 */
  padding: 0 var(--xk-space-2);
  border: 0;
  border-radius: var(--xk-radius-blob-sm);
  background: none;
  color: var(--xk-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.opt.on {
  background: var(--xk-surface-2);
}

.av {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}

.av-ph {
  background: var(--xk-surface-2);
}

.nm {
  font-size: var(--xk-fs-14);
  /* 昵称可能很长，截断而不是把用户名挤走 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.un {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
}
</style>