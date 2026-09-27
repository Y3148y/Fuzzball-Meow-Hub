import { ref, watch } from 'vue'

/**
 * 双 token 的唯一真相来源。
 *
 * 为什么要单独抽一个模块：
 * token 同时被两处写 —— Axios 拦截器（刷新成功后覆盖）和 Pinia store（登录/登出）。
 * 如果 store 用 computed 去读 localStorage 判断登录态，会踩一个很隐蔽的坑：
 * localStorage 不是响应式源，computed 算完一次就永久缓存，之后登录成功也不会重算，
 * 于是守卫会把刚登录的用户又弹回登录页。
 *
 * 所以这里用 ref 承接，localStorage 只作为「刷新页面后恢复」的角色：
 * ref 负责响应式，watch 负责持久化，拦截器和 store 改的都是同一份 ref。
 */
const ACCESS_TOKEN_KEY = 'xk_token'
const REFRESH_TOKEN_KEY = 'xk_refresh_token'

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    // 隐私模式下 localStorage 会抛错
    return ''
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // 存不进去就只在内存里用，不影响本次会话
  }
}

export const accessToken = ref(read(ACCESS_TOKEN_KEY))
export const refreshToken = ref(read(REFRESH_TOKEN_KEY))

watch(accessToken, (v) => write(ACCESS_TOKEN_KEY, v))
watch(refreshToken, (v) => write(REFRESH_TOKEN_KEY, v))

/** 登录成功后一次性写入双 token */
export function setTokens(access: string, refresh: string) {
  accessToken.value = access
  refreshToken.value = refresh
}

export function setAccessToken(access: string) {
  accessToken.value = access
}

export function clearTokens() {
  accessToken.value = ''
  refreshToken.value = ''
}
