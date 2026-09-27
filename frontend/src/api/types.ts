/**
 * 与后端统一响应体 Result 对齐的泛型封装。
 *
 * <p>面试可讲：为什么不直接把 axios 的 response 丢给业务层？
 * 因为那会让每个页面都要写 `res.data.data.xxx`，
 * 且业务错误（code != 0）和网络错误混在一起，try/catch 容易漏。
 * 统一在拦截器里剥离，业务层只关心「拿到就是数据，失败一定抛异常」。
 */

export interface Result<T = unknown> {
  code: number
  message: string
  data: T
}

export const CODE_SUCCESS = 0

/** 业务错误码，与后端 ErrorCodeEnum 保持一致 */
export const ErrorCode = {
  USER_NOT_FOUND: 10001,
  USERNAME_OR_PASSWORD_ERROR: 10002,
  USERNAME_ALREADY_EXISTS: 10003,
  PHONE_ALREADY_EXISTS: 10004,
  UNAUTHORIZED: 10005,
  TOKEN_INVALID: 10006,
  USER_DISABLED: 10007,
  PARAM_VALIDATION_ERROR: 100001,
  REPEAT_SUBMIT: 100004,
  RATE_LIMITED: 100005,
  SYSTEM_ERROR: 100999,
} as const

/**
 * 需要重新登录的错误码。
 * 后端对「未带 token」和「token 非法/过期」都归到鉴权失败，
 * 前端统一走刷新流程，刷新也失败才清登录态。
 */
export const AUTH_ERROR_CODES: readonly number[] = [
  ErrorCode.UNAUTHORIZED,
  ErrorCode.TOKEN_INVALID,
]

/** 用户信息，对应后端 UserVO */
export interface UserVO {
  id: number
  username: string
  nickname: string
  avatar: string | null
  bio: string | null
  /** 0 未知 1 男 2 女 */
  gender: number
  followCount: number
  fansCount: number
  likeReceivedCount: number
  /** 后端是 LocalDateTime，默认序列化成 "2026-09-23T10:58:35" */
  createTime: string
}

/** 登录结果，对应后端 LoginVO */
export interface LoginVO {
  accessToken: string
  refreshToken: string
  /** access token 剩余有效秒数 */
  expiresIn: number
  userInfo: UserVO
}

export interface LoginDTO {
  username: string
  password: string
}

export interface RegisterDTO {
  username: string
  password: string
  nickname?: string
}

/** P0 环境自检接口返回体，对应后端 SystemController 的 ping */
export interface PingVO {
  applicationName: string
  machineId: number
  snowflakeId: number
  snowflakeParsed: string
  serverTime: string
}
