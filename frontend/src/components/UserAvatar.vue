<script setup lang="ts">
/**
 * 全站统一的头像渲染。
 *
 * <p><b>为什么要有这个组件</b>：2026-10-17 之前，头像在 **10 个视图**里各写各的 ——
 * 三个页面把吉祥物写死当头像、`MessageListView` 用 `?? '/mascot/m02.webp'`、
 * `ImmerseView` 用灰色空圆、私信用 `?? ''`（于是裂图）。
 * 四种写法并存，直接后果是：
 * <ul>
 *   <li>「用户没有头像」在不同页面表现完全不同</li>
 *   <li><code>?? ''</code> 那一处让空头像变成 <code>&lt;img src=""&gt;</code> → 裂图</li>
 *   <li>用户换了头像，有 8 个页面不会跟着变</li>
 * </ul>
 * 组件把这三件事收成一处：<b>取值 → 兜底 → 尺寸/形状</b>。
 *
 * <p>兜底是吉祥物 <code>/mascot/m02.webp</code>（沿用全站约定）。
 * 现在用户表里的 avatar 已全部回填成预设头像，这个兜底只在
 * 「后端返回了空 avatar」时才真正触发 —— 也就是说它现在是**最后一道保险**，
 * 而不是说「大家都没有头像」。
 *
 * <p>⚠️ 永远渲染 <code>&lt;img&gt;</code>、不用 v-if/v-else：
 * 没有头像时也有一张吉祥物图，于是 <code>src=""</code> 这条路径
 * 结构上不存在（P35 的裂图就是这么来的）。
 */
import { computed } from 'vue'

const MASCOT = '/mascot/m02.webp'

const props = withDefaults(defineProps<{
  /** 头像地址；null/undefined/空串都走兜底 */
  avatar?: string | null
  /** 昵称，用作 alt；不给就用默认文案 */
  nickname?: string | null
  /** 边长 px */
  size?: number
  /** 圆角方形（沉浸流卡片用）而不是正圆 */
  square?: boolean
  /** 透传给 data-test，便于测试定位 */
  test?: string
}>(), { size: 34, square: false, test: undefined })

const src = computed(() => props.avatar || MASCOT)
const alt = computed(() => props.nickname ? `${props.nickname} 的头像` : '头像')
</script>

<template>
  <img
    class="xk-avatar"
    :class="{ square }"
    :src="src"
    :alt="alt"
    :width="size"
    :height="size"
    :data-test="test"
  >
</template>

<style scoped>
.xk-avatar {
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: cover;
  background: var(--xk-surface-2);
}
.xk-avatar.square { border-radius: var(--xk-radius-md, 10px); }
</style>