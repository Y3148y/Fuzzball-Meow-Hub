<script setup lang="ts">
/**
 * 举报弹窗（P21）
 *
 * <p>**为什么抽成组件而不是每个视图各写一份**：举报有三个入口
 * （笔记详情页的「⋯」、评论的「⋯」、作者主页的「⋯」），而完整流程有五步：
 * 拉原因列表 → 选对象 → 选原因 → 提交 → 处理 80003 重复举报。
 * 抄三遍就意味着「加一步要改三处」，而漏掉 80003 那步的症状是
 * 第二次举报时用户以为提交失败了。
 *
 * <p>**原因选项来自后端，不写死在前端**：运营随时能加/改分类
 * （比如「诱导互动」），写死就得跟着发版才能改。
 *
 * <p>用**自定义浮层**而不是 `van-action-sheet`：原因是一个可点的列表，
 * 而且选完对象（如果有多个）还要留在同一个浮层里。改成两步对话框会让
 * 「先选内容再选原因」变成两次点击并丢掉已选状态。
 */
import { useReportSheet } from '@/composables/useReportSheet'

const sheet = useReportSheet()
</script>

<template>
  <div
    v-if="sheet.open.value"
    class="sheet"
    role="dialog"
    aria-modal="true"
    :aria-label="sheet.title.value"
    data-test="report-sheet"
  >
    <p class="sheet-title">{{ sheet.title.value }}</p>

    <!--
      ⚠️ 下面这四块刻意**不用 v-if / v-else-if 链**。
      Vue 的 else 链挂在**紧邻的上一个 v-if** 上，写成
      `<p v-if=A><ul v-if=B><p v-else-if=C>` 时，C 的 else 挂的是 **B** 而不是 A，
      于是 B 渲染时 C/D 全都不渲染 —— 症状是「选了内容也不显示『已选择』」，
      而真因在模板结构里，离现象隔了三行（2026-10-08 首次跑 CDP 撞到）。
      四块各自独立判断，反而更清楚。
    -->
    <p v-if="sheet.targets.value.length > 1" class="sheet-sub">选择要举报的内容：</p>
    <ul v-if="sheet.targets.value.length > 1" class="sheet-list" data-test="report-targets">
      <li v-for="t in sheet.targets.value" :key="'n' + t.id">
        <button
          class="sheet-item"
          type="button"
          :class="{ on: sheet.picked.value?.id === t.id }"
          :data-test="'report-target-' + t.id"
          @click="sheet.picked.value = t"
        >
          {{ t.title }}
        </button>
      </li>
    </ul>
    <p
      v-if="sheet.targets.value.length === 0"
      class="sheet-hint"
      data-test="report-no-target"
    >
      没有可举报的内容
    </p>
    <p
      v-if="sheet.targets.value.length === 1 && sheet.picked.value"
      class="sheet-sub"
      data-test="report-picked"
    >
      已选择：{{ sheet.picked.value.title }}
    </p>
    <p
      v-if="sheet.targets.value.length > 1 && sheet.picked.value"
      class="sheet-sub"
      data-test="report-picked"
    >
      已选择：{{ sheet.picked.value.title }}
    </p>

    <p class="sheet-sub">选择举报原因：</p>
    <ul class="sheet-list">
      <li v-for="r in sheet.reasons.value" :key="r.code">
        <button
          class="sheet-item sheet-pill"
          type="button"
          :disabled="sheet.busy.value"
          data-test="report-reason"
          @click="sheet.submit(r)"
        >
          {{ r.text }}
        </button>
      </li>
    </ul>

    <button class="sheet-cancel" type="button" data-test="report-cancel" @click="sheet.close()">
      取消
    </button>
  </div>
</template>
