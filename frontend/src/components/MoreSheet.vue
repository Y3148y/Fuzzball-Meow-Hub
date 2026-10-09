<script setup lang="ts">
/**
 * 「⋯ 更多」浮层（P21）
 *
 * <p>**为什么做成组件而不是各视图各写一个 van-action-sheet**：
 * 三个入口（笔记详情页、评论项、作者主页）要同样的两件事 ——
 * 「⋯ 按钮 + 动作列表」。样式（热区 44px、字阶）在 main.css 里全局，
 * 在这里再抄一遍 scoped 就是三个地方要同步。
 *
 * <p>对齐小红书的做法（2026-10-08 查证）：拉黑与举报都收在右上角「⋯」的
 * 浮层里，作者主页头部只留「关注」。我们原来把「拉黑」「举报」两个文字链接
 * 平铺在头部那一行 flex 里，430px 下被压成两行并被卡片裁掉
 * （「拉黑」被拆成上下两个「拉」「黑」）。
 *
 * <p>它**只管菜单**，不管举报 —— 举报是三步流程（选对象 → 选原因 → 提交），
 * 那是 {@link ReportSheet} 的事。把两者塞进一个组件会让菜单变成一个
 * 「什么都能干」的抽屉。
 */
import { computed, ref } from 'vue'

export interface MoreAction {
  /** 动作标识，通过 `select` 事件抛出去 */
  key: string
  label: string
  /** 危险动作（删除、拉黑、举报）用 danger 色 */
  danger?: boolean
  /** 副标题，说明这一步会发生什么 */
  subname?: string
}

const props = defineProps<{
  actions: MoreAction[]
  /** 无障碍标签与浮层标题，例如「这篇笔记的操作」 */
  label: string
  /** 测试定位用；三处入口各传一个，断言才能区分是哪个入口 */
  testid?: string
}>()

const emit = defineEmits<{ (e: 'select', key: string): void }>()

const show = ref(false)

/**
 * ⚠️ Vant `ActionSheetAction` 的字段只有 `name` / `subname` / `callback` / `className`
 * —— **没有 `label`，也没有 `text`**。
 *
 * 我连着猜错两次（先写 `label`、再写 `text`），两次都不报错：
 * 未知的字段被静默忽略，浮层照常打开，只是每项只剩 subname 的字。
 * 2026-10-08 首次跑 CDP 撞到，症状是「菜单里两项，但显示的是
 * `report` / `block` 这种 key」。
 *
 * 而 `key` 要回传就得自定义字段：Vant 的 `@select` 把**整个 action 对象**
 * 原样传回来，自定义字段能透传，所以用 `xkKey` 而不是靠 index。
 */
const vantActions = computed(() =>
  props.actions.map((a) => ({
    name: a.label,
    xkKey: a.key,
    subname: a.subname,
    color: a.danger ? 'var(--xk-danger)' : undefined,
  })),
)

function run(a: { xkKey?: string }) {
  show.value = false
  if (a?.xkKey) emit('select', a.xkKey)
}
</script>

<template>
  <button
    class="more-btn"
    type="button"
    :aria-label="props.label"
    :aria-expanded="show"
    :data-test="props.testid ?? 'more-btn'"
    @click="show = true"
  >
    <span class="glyph" aria-hidden="true">⋯</span>
  </button>

  <van-action-sheet
    v-model:show="show"
    :actions="vantActions"
    :title="props.label"
    cancel-text="取消"
    close-on-click-action
    :data-test="(props.testid ?? 'more') + '-sheet'"
    @select="run"
  />
</template>
