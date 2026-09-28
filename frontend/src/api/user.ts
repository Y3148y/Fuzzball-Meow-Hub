import type { AxiosRequestConfig } from 'axios'
import { post, get, put } from './request'
import type { LoginDTO, LoginVO, ProfilePatch, RegisterDTO, UserVO } from './types'

/**
 * 用户模块接口。
 * 路径对应后端 UserController 的 @RequestMapping("/api/user")，
 * 而 request 实例的 baseURL 已经是 /api，所以这里从 /user 开始写。
 */

/** 登录/注册的错误由表单内联展示，不要再弹一次全局 toast */
const SILENT = { _xkSilent: true } as AxiosRequestConfig

/** 注册。成功后不自动登录，需要再调一次 login */
export function register(data: RegisterDTO) {
  return post<UserVO>('/user/register', data, SILENT)
}

/** 登录，返回 access + refresh 双 token */
export function login(data: LoginDTO) {
  return post<LoginVO>('/user/login', data, SILENT)
}

/**
 * 刷新令牌。
 *
 * 注意这里是 query 而不是 body：后端签名是 @RequestParam String refreshToken，
 * 用 @RequestBody 的话 refreshToken 永远是 null。这个坑写在这里免得下次再踩。
 */
export function refreshToken(token: string) {
  return post<LoginVO>('/user/refresh', undefined, { params: { refreshToken: token } })
}

/** 当前登录用户，走 Redis 缓存 */
export function getCurrentUser() {
  return get<UserVO>('/user/me')
}

/** 部分更新个人资料 */
export function updateProfile(data: ProfilePatch) {
  return put<UserVO>('/user/profile', data)
}
