<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import SiteNav from '@/components/SiteNav.vue'
import TabBar from '@/components/TabBar.vue'
import { useUnreadCount } from '@/composables/useUnreadCount'
import { useMessageUnread } from '@/composables/useMessageUnread'

// 根组件：负责布局与「冷启动恢复登录态」，具体页面由 router-view 承载
const userStore = useUserStore()
const route = useRoute()

// 登录页不挂顶栏，登录卡片自己就是全部
const showNav = computed(() => route.name !== 'login')

// 刷新页面 / 重新打开标签页时内存里没有用户信息，靠这里补一次 /me
onMounted(() => {
  void userStore.restore()
})

// 未读数统一在这里刷：桌面铃铛（在 SiteNav 内）与「我的」页的通知行共用
// 一份数据 —— 各自拉会变成两个请求 + 两份可能不一致的数字。
const { refresh: refreshUnread } = useUnreadCount()
// 私信未读（P22）是**另一个**接口、另一张表、另一种「未读」，
// 刻意不与通知合并成一个 ref —— 合并后每次刷新都要传「这次刷哪个」的 flag。
const { refresh: refreshMessageUnread } = useMessageUnread()

watch(
  () => route.fullPath,
  () => {
    void refreshUnread()
    void refreshMessageUnread()
  },
  { immediate: true },
)
</script>

<template>
  <SiteNav v-if="showNav" />
  <router-view v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
  <!-- 移动端底部主导航；显示/隐藏哪些路由由 TabBar 自己判断（见组件内 HIDDEN_ROUTES） -->
  <TabBar />
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
