<script setup lang="ts">
import { onMounted } from 'vue'
import { useUserStore } from '@/stores/user'

// 根组件：负责布局与「冷启动恢复登录态」，具体页面由 router-view 承载
const userStore = useUserStore()

// 刷新页面 / 重新打开标签页时内存里没有用户信息，靠这里补一次 /me
onMounted(() => {
  void userStore.restore()
})
</script>

<template>
  <router-view v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
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
