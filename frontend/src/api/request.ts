import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { showFailToast } from 'vant'
import { CODE_SUCCESS, ErrorCode, type Result } from './types'

/**
 * token 存取集中在这里。
 * 之所以用 localStorage 而不是 Cookie：
 * - 实现简单，前端可读，方便在 Axios 拦截器里拼 Authorization 头
 * - 代价是 XSS 风险：如果前端有注入漏洞，token 会被同源脚本读到
 * 生产项目更倾向 HttpOnly Cookie + CSRF Token，这里为了贴近校招项目选前者。
 */
const TOKEN_KEY = 'xk_token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) ?? '',
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

const http: AxiosInstance = axios.create({
  // 走 Vite 代理 / Nginx 转发，代码里不出现具体域名
  baseURL: import.meta.env.VITE_API_BASE ?? '/api',
  timeout: 15000,
})

http.interceptors.request.use(
  (config) => {
    const token = tokenStore.get()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

http.interceptors.response.use(
  (response) => {
    const body = response.data as Result

    // 文件流等非 Result 结构的响应直接透传
    if (body === null || typeof body !== 'object' || !('code' in body)) {
      return response.data
    }

    if (body.code === CODE_SUCCESS) {
      return body.data
    }

    // token 失效：清空本地登录态并跳登录页。
    // 这里不做「自动刷新 token」——刷新逻辑放在 P2 的 AuthStore 里统一处理
    if (body.code === ErrorCode.UNAUTHORIZED || body.code === ErrorCode.TOKEN_INVALID) {
      tokenStore.clear()
      if (!location.hash.startsWith('#/login')) {
        location.hash = '#/login'
      }
      return Promise.reject(new Error(body.message))
    }

    showFailToast(body.message || '操作失败')
    return Promise.reject(new Error(body.message))
  },
  (error) => {
    // 网络层错误：超时、断网、后端 5xx
    const message =
      error.code === 'ECONNABORTED' ? '请求超时，请稍后重试' : error.message || '网络异常'
    showFailToast(message)
    return Promise.reject(error)
  },
)

export function get<T>(url: string, params?: object, config?: AxiosRequestConfig): Promise<T> {
  return http.get(url, { params, ...config }) as unknown as Promise<T>
}

export function post<T>(url: string, data?: object, config?: AxiosRequestConfig): Promise<T> {
  return http.post(url, data, config) as unknown as Promise<T>
}

export default http
