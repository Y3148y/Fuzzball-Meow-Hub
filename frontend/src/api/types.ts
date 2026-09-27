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
  UNAUTHORIZED: 10005,
  TOKEN_INVALID: 10006,
} as const
