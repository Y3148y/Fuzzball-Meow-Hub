<script setup lang="ts">
/**
 * 通知铃铛 —— 只出现在**桌面**的 SiteNav 里
 *
 * <p>为什么不做成全局 fixed 浮标：试过，移动端（<1024）每个页面顶栏右上角本来就有
 * 「主题切换 / 返回」，fixed 铃铛会直接压上去 —— 布局体检在首页/搜索/我的三页各报
 * 2 处重叠（overlap notification-bell × theme-toggle / search-back）。
 *
 * <p>移动端按小红书的做法：通知是「我」页里的一行（见 ProfileView 的
 * {@code me-notify-link}），不做浮动铃铛。两处共用
 * {@link useUnreadCount} 的未读数，显示逻辑不会不一致。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUnreadCount } from '@/composables/useUnreadCount'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const { unread } = useUnreadCount()

/** 登录页与通知页本身不显示（点铃铛却还停在这页没有意义） */
const show = computed(() => route.name !== 'login' && route.name !== 'notification' && userStore.isLogin)
</script>

<template>
  <button
    v-if="show"
    class="bell"
    type="button"
    :aria-label="unread > 0 ? `通知，${unread} 条未读` : '通知'"
    data-test="notification-bell"
    @click="router.push({ name: 'notification' })"
  >
    <van-icon name="bell" />
    <span v-if="unread > 0" class="dot" data-test="notification-unread">{{ unread }}</span>
  </button>
</template>

<style scoped>
/*
  在 SiteNav 的 links 里正常排列（不是 fixed）—— 所以绝不会和页面顶栏抢位置。
  绝对定位方案已实测会造成重叠，见文件头注释。
*/
.bell {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--xk-radius-blob-sm);
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-20);
  cursor: pointer;
}

.bell:hover {
  color: var(--xk-amber-text);
  background: var(--xk-surface-2);
}

.dot {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #e5484d;
  color: #fff;
  font-size: var(--xk-fs-12);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
</style>