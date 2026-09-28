import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import { showFailToast } from 'vant'
import { accessToken, clearTokens, refreshToken, setTokens } from './token'
import { AUTH_ERROR_CODES, CODE_SUCCESS, type Result } from './types'

/** 带业务错误码的异常，让页面能按 code 分支处理，而不只是拿到一句话 */
export class BizError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'BizError'
    this.code = code
  }
}

interface XkConfig extends InternalAxiosRequestConfig {
  /** 已经重放过一次，避免鉴权失败时无限循环 */
  _xkRetried?: boolean
  /** 刷新接口自己要用，不能再触发刷新 */
  _xkSkipAuth?: boolean
  /** 静默：不弹全局 toast，由调用方自己展示（如登录表单内联报错） */
  _xkSilent?: boolean
}

const http: AxiosInstance = axios.create({
  // 走 Vite 代理 / Nginx 转发，代码里不出现具体域名
  baseURL: import.meta.env.VITE_API_BASE ?? '/api',
  timeout: 15000,
})

http.interceptors.request.use(
  (config) => {
    if (accessToken.value) {
      config.headers.Authorization = `Bearer ${accessToken.value}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

/**
 * 正在进行的刷新任务。
 *
 * 为什么要「单飞」：access token 过期时，页面往往同时有好几个请求在飞
 * （用户信息、笔记列表、评论数……），它们会一起撞上 401。
 * 如果每个请求各自去刷新，就会并发打出 N 个 refresh 请求，
 * 而后端的 refresh token 是会轮换的 —— 并发刷新时只有第一个能成功，
 * 其余全部失败，反而把用户踢下线。
 * 所以用一个共享的 Promise 排队，后到的请求等同一个结果。
 */
let refreshTask: Promise<boolean> | null = null

function clearLoginAndRedirect() {
  clearTokens()
  if (!location.hash.startsWith('#/login')) {
    location.hash = '#/login'
  }
}

/** 刷新接口的响应体（后端 LoginVO） */
interface RefreshPayload {
  accessToken: string
  refreshToken: string
}

/**
 * 专供「刷新 token」这一个接口使用的裸 client。
 *
 * 为什么不复用 http：
 * 1. http 的响应拦截器会把 { code, data } 解包成 data，刷新这里需要看到完整信封
 *    才能判断 code / message，早期版本就是踩了这个坑 —— 解包后又去读 .data，
 *    拿到 undefined，于是一次成功刷新被误判成失败，用户在 access 正常过期时
 *    被直接踢下线，正好是这个机制要防的事。
 * 2. 刷新请求不能带可能已失效的 access token，也不该弹全局 toast。
 * 所以这里刻意绕开所有拦截器，自己解析信封。
 */
const rawHttp = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '/api',
  timeout: 15000,
})

function refreshAccessToken(): Promise<boolean> {
  if (refreshTask) return refreshTask

  const rt = refreshToken.value
  if (!rt) {
    clearLoginAndRedirect()
    return Promise.resolve(false)
  }

  refreshTask = rawHttp
    // refreshToken 走 query：后端是 @RequestParam，放 body 拿不到
    .post<Result<RefreshPayload>>('/user/refresh', null, { params: { refreshToken: rt } })
    .then((res) => {
      const body = res.data
      if (body?.code === CODE_SUCCESS && body.data?.accessToken) {
        // 后端会轮换 refreshToken，必须一起覆盖，否则旧的下次就废了
        setTokens(body.data.accessToken, body.data.refreshToken || rt)
        return true
      }
      clearLoginAndRedirect()
      return false
    })
    .catch(() => {
      clearLoginAndRedirect()
      return false
    })
    .finally(() => {
      refreshTask = null
    })

  return refreshTask
}

http.interceptors.response.use(
  async (response) => {
    const body = response.data as Result
    const config = response.config as XkConfig

    // 文件流等非 Result 结构的响应直接透传
    if (body === null || typeof body !== 'object' || !('code' in body)) {
      return response.data
    }

    if (body.code === CODE_SUCCESS) {
      return body.data
    }

    // 鉴权失败：先尝试静默刷新一次，成功就把原请求重放掉，用户无感
    if (
      AUTH_ERROR_CODES.includes(body.code) &&
      !config._xkSkipAuth &&
      !config._xkRetried &&
      refreshToken.value
    ) {
      if (await refreshAccessToken()) {
        config._xkRetried = true
        return http.request(config) as unknown as Promise<unknown>
      }
    }

    if (AUTH_ERROR_CODES.includes(body.code)) {
      clearLoginAndRedirect()
      return Promise.reject(new BizError(body.code, body.message))
    }

    if (!config._xkSilent) {
      showFailToast(body.message || '操作失败')
    }
    return Promise.reject(new BizError(body.code, body.message))
  },
  (error) => {
    // 网络层错误：超时、断网、后端 5xx
    const message =
      error.code === 'ECONNABORTED' ? '请求超时，请稍后重试' : error.message || '网络异常'
    const config = (error.config ?? {}) as XkConfig
    if (!config._xkSilent) {
      showFailToast(message)
    }
    return Promise.reject(error)
  },
)

export function get<T>(url: string, params?: object, config?: AxiosRequestConfig): Promise<T> {
  return http.get(url, { params, ...config }) as unknown as Promise<T>
}

export function post<T>(
  url: string,
  data?: object,
  config?: AxiosRequestConfig,
): Promise<T> {
  return http.post(url, data, config) as unknown as Promise<T>
}

export function put<T>(url: string, data?: object, config?: AxiosRequestConfig): Promise<T> {
  return http.put(url, data, config) as unknown as Promise<T>
}

/**
 * DELETE。
 *
 * 取消点赞 / 取消收藏 / 删除评论都走它，参数放 query 而不是 body：
 * 这些接口没有请求体，用 body 反而会让某些网关和 CDN 对 DELETE 的处理
 * 出现分歧（有的会丢弃 body）。
 */
export function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return http.delete(url, config) as unknown as Promise<T>
}

export default http
