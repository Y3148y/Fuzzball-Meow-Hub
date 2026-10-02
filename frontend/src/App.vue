<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import SiteNav from '@/components/SiteNav.vue'
import TabBar from '@/components/TabBar.vue'

// 根组件：负责布局与「冷启动恢复登录态」，具体页面由 router-view 承载
const userStore = useUserStore()
const route = useRoute()

// 登录页不挂顶栏，登录卡片自己就是全部
const showNav = computed(() => route.name !== 'login')

// 刷新页面 / 重新打开标签页时内存里没有用户信息，靠这里补一次 /me
onMounted(() => {
  void userStore.restore()
})
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
