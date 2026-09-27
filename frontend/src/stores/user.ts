/**
 * 全局登录态。
 * P0 阶段只有骨架，真实的登录/刷新 token 逻辑在 P2 用户模块实现。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { tokenStore } from '@/api/request'

export const useUserStore = defineStore('user', () => {
  const userId = ref<string>('')
  const username = ref<string>('')

  const isLogin = computed(() => tokenStore.get().length > 0)

  function setLogin(payload: { userId: string; username: string; token: string }) {
    userId.value = payload.userId
    username.value = payload.username
    tokenStore.set(payload.token)
  }

  function logout() {
    userId.value = ''
    username.value = ''
    tokenStore.clear()
  }

  return { userId, username, isLogin, setLogin, logout }
})
