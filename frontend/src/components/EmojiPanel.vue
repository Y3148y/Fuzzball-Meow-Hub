<script setup lang="ts">
/**
 * 表情面板
 *
 * <p>⚠️ **Vant 4 没有 emoji 组件**。查过 `vant/lib/index.css`，
 * 没有 `van-emoji` / `van-emoticon` 之类的规则（`van-icon` 只是图标字体，
 * 里面只有箭头/星星/垃圾桶那类 UI 图标，没有表情）。
 * 所以自研，而不是 `npm i` 引入一个只为这一个面板的依赖。
 *
 * <p>**它只做两件事**：选一个表情插进输入框、删掉一个插入的字符。
 * 刻意不做：自定义表情上传（那是账号级的另一套资产）、表情商店、
 * 搜索表情。前三者都要服务端支撑，与「能和对方聊起来」这个目标正交。
 */
import { ref } from 'vue'

const emit = defineEmits<{ (e: 'pick', text: string): void }>()

/**
 * 表情分两组：常用（高频）+ 手势/表情/符号/动物
 *
 * <p>⚠️ **不要用 emoji 连字簇（ZWJ 序列）**：👨‍👩‍👧‍👦 这类由多个码点 + 零宽连接符组成，
 * 计算「删掉一个表情」的长度时很容易错位（一个 emoji 可能占 7+ 个 UTF-16 单元）。
 * 这里全是单码点或成对符号，**一个表情恰好 1~2 个 UTF-16 单元**，可预测。
 */
const GROUPS: { name: string; items: string[] }[] = [
  {
    name: '常用',
    items: [
      '\u{1F604}', '\u{1F60A}', '\u{1F60D}', '\u{1F621}', '\u{1F614}',
      '\u{1F622}', '\u{1F62D}', '\u{1F631}', '\u{1F60F}', '\u{1F44D}',
      '\u{1F44B}', '\u{2764}\u{FE0F}', '\u{1F44F}', '\u{1F64C}', '\u{1F389}',
      '\u{1F440}',
    ],
  },
  {
    name: '手势',
    items: [
      '\u{1F44B}\u{1F3FB}', '\u{1F44C}\u{1F3FB}', '\u{1F44D}\u{1F3FB}',
      '\u{270C}\u{FE0F}', '\u{1F91D}', '\u{1F91E}', '\u{1F44F}\u{1F3FB}',
      '\u{1F91F}', '\u{1F590}\u{FE0F}', '\u{270B}', '\u{1F596}', '\u{1F645}',
    ],
  },
  {
    name: '表情',
    items: [
      '\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F60A}', '\u{1F60B}',
      '\u{1F60C}', '\u{1F60D}', '\u{1F60E}', '\u{1F60F}', '\u{1F610}',
      '\u{1F611}', '\u{1F612}', '\u{1F613}', '\u{1F614}', '\u{1F615}',
      '\u{1F616}', '\u{1F617}', '\u{1F618}', '\u{1F619}', '\u{1F61A}',
      '\u{1F61B}', '\u{1F61C}', '\u{1F61D}', '\u{1F61E}', '\u{1F61F}',
      '\u{1F620}', '\u{1F621}', '\u{1F622}', '\u{1F623}', '\u{1F624}',
      '\u{1F625}', '\u{1F626}', '\u{1F627}', '\u{1F628}', '\u{1F629}',
      '\u{1F62A}', '\u{1F62B}', '\u{1F62C}', '\u{1F62D}', '\u{1F62E}',
      '\u{1F62F}', '\u{1F630}', '\u{1F631}', '\u{1F632}', '\u{1F633}',
      '\u{1F634}', '\u{1F635}', '\u{1F636}', '\u{1F637}', '\u{1F638}',
      '\u{1F639}', '\u{1F63A}', '\u{1F63B}', '\u{1F63C}',
    ],
  },
  {
    name: '动物',
    items: [
      '\u{1F435}', '\u{1F412}', '\u{1F429}', '\u{1F43A}', '\u{1F98A}',
      '\u{1F415}', '\u{1F408}', '\u{1F42E}', '\u{1F439}', '\u{1F430}',
      '\u{1F414}', '\u{1F989}', '\u{1F33B}',
    ],
  },
  {
    name: '符号',
    items: [
      '\u{1F4A9}', '\u{2728}', '\u{1F525}', '\u{1F4AF}', '\u{1F680}',
      '\u{1F44C}\u{FE0F}', '\u{2705}', '\u{274C}', '\u{2757}',
      '\u{2764}\u{FE0F}', '\u{1F48B}', '\u{1F49A}', '\u{1F4A4}',
      '\u{1F4AA}', '\u{1F4DD}', '\u{1F4CE}', '\u{23F0}', '\u{231B}',
      '\u{2B50}', '\u{1F4AF}',
    ],
  },
]

const active = ref(0)

function pick(t: string) {
  emit('pick', t)
}
</script>

<template>
  <div class="emoji" data-test="emoji-panel" role="dialog" aria-label="表情面板">
    <!-- 分组 tab：aria-selected 而非仅样式高亮（与发现/关注 tab 同一原则） -->
    <div class="tabs" role="tablist" aria-label="表情分组">
      <button
        v-for="(g, i) in GROUPS"
        :key="g.name"
        type="button"
        role="tab"
        class="tab"
        :class="{ on: active === i }"
        :aria-selected="active === i"
        :data-test="'emoji-tab-' + g.name"
        @click="active = i"
      >{{ g.name }}</button>
    </div>

    <div class="grid" :data-test="'emoji-grid-' + GROUPS[active].name">
      <button
        v-for="t in GROUPS[active].items"
        :key="t"
        type="button"
        class="cell"
        :aria-label="'插入表情 ' + t"
        :data-emoji="t"
        data-test="emoji-item"
        @click="pick(t)"
      >{{ t }}</button>
    </div>
  </div>
</template>

<style scoped>
.emoji {
  border-top: 1px solid var(--xk-stroke);
  background: var(--xk-surface-1);
}
/* 面板固定高度，网格滚动 —— 否则 42 个表情把页面顶高一屏 */
.emoji { height: 236px; display: flex; flex-direction: column; }

.tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--xk-stroke);
  flex: 0 0 auto;
}
.tab {
  flex: 1 1 auto;
  min-height: 40px;
  border: 0;
  background: none;
  font-size: var(--xk-fs-14);
  color: var(--xk-text-2);
  cursor: pointer;
  padding: 0;
  border-bottom: 2px solid transparent;
}
.tab.on {
  color: var(--xk-text);
  font-weight: 600;
  border-bottom-color: var(--xk-amber);
}

.grid {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  gap: 2px;
  padding: var(--xk-space-2);
}
.cell {
  /* 44px 是 P13 定下的最小热区；表情比图标密集但更常被乱点 */
  min-width: 44px;
  min-height: 44px;
  border: 0;
  background: none;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  border-radius: var(--xk-radius-sm);
  /* ⚠️ 必须抑制默认的按压高亮色：它的半透明灰会盖住 emoji 的黄，
     按下去整张脸变灰，看起来像"表情坏了" */
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease, background-color 0.12s ease;
}
.cell:active { transform: scale(0.86); background: var(--xk-surface-2); }

@media (prefers-reduced-motion: reduce) {
  .cell { transition: none; }
}
</style>