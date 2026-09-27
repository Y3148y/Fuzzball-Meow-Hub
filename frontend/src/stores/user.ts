import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { accessToken, clearTokens, setTokens } from '@/api/token'
import * as userApi from '@/api/user'
import type { LoginDTO, RegisterDTO, UserVO } from '@/api/types'

/**
 * 全局登录态。
 *
 * <p>token 本身存在 src/api/token.ts 里（ref + localStorage 双向同步），
 * 因为它同时被 Axios 拦截器和 store 读写；这里只管「用户是谁」和「登录动作」。
 */
export const useUserStore = defineStore('user', () => {
  const userInfo = ref<UserVO | null>(null)
  const profileLoading = ref(false)

  const isLogin = computed(() => accessToken.value.length > 0)
  const displayName = computed(() => userInfo.value?.nickname || userInfo.value?.username || '')

  async function login(dto: LoginDTO) {
    const res = await userApi.login(dto)
    setTokens(res.accessToken, res.refreshToken)
    userInfo.value = res.userInfo
    return res
  }

  /** 注册成功不自动登录（与后端约定一致），需要用户再点一次登录 */
  async function register(dto: RegisterDTO) {
    return userApi.register(dto)
  }

  /** 拉一次当前用户，走后端 Redis 缓存，顺便验证 token 是否还有效 */
  async function loadProfile() {
    profileLoading.value = true
    try {
      userInfo.value = await userApi.getCurrentUser()
      return userInfo.value
    } finally {
      profileLoading.value = false
    }
  }

  /**
   * 应用启动时恢复登录态。
   * 有 token 但内存里没有用户信息（例如刷新页面、重新打开标签页）才去请求，
   * 避免每次冷启动都打一次 /me。失败不抛错：token 失效时拦截器已经处理了跳转。
   */
  async function restore() {
    if (!isLogin.value || userInfo.value) return
    try {
      await loadProfile()
    } catch {
      // 静默失败，交给拦截器
    }
  }

  function logout() {
    clearTokens()
    userInfo.value = null
  }

  return {
    userInfo,
    profileLoading,
    isLogin,
    displayName,
    login,
    register,
    loadProfile,
    restore,
    logout,
  }
})
