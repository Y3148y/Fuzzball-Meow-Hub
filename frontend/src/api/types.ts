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
  // 20xxx 笔记域
  NOTE_NOT_FOUND: 20001,
  NOTE_STATUS_ILLEGAL: 20002,
  NOTE_UPLOAD_FAILED: 20003,
  NOTE_IMAGE_LIMIT_EXCEED: 20004,
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

/**
 * <b>雪花 ID 是字符串，不是 number。</b>
 *
 * <p>后端 JacksonConfig 把 Long 一律序列化成字符串。原因是雪花 ID 量级 10^17，
 * 超出 JS 的 Number.MAX_SAFE_INTEGER（9.007×10^15），
 * 用 number 接收会静默丢精度：JSON.parse 出来的值和后端存的不是同一个数，
 * 回传查询就「明明有数据却查不到」。
 * 所以类型必须写 string，赋值时也不要用 Number()/parseInt 转换。
 */
export type SnowflakeId = string

/** 用户信息，对应后端 UserVO */
export interface UserVO {
  id: SnowflakeId
  username: string
  nickname: string
  avatar: string | null
  bio: string | null
  /** 0 未知 1 男 2 女 */
  gender: number
  followCount: number
  fansCount: number
  likeReceivedCount: number
  /** 后端是 LocalDateTime，默认序列化出 "2026-09-23T10:58:35" */
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
  /** 雪花 ID 样本，同样是字符串 */
  snowflakeId: SnowflakeId
  snowflakeParsed: string
  serverTime: string
}

/** 单篇笔记图片上限，与后端 NOTE_IMAGE_LIMIT_EXCEED 的文案一致 */
export const NOTE_IMAGE_LIMIT = 9

/** 笔记详情，对应后端 NoteVO */
export interface NoteVO {
  id: SnowflakeId
  /** 1 图文 2 视频 */
  type: number
  title: string
  content: string
  cover: string | null
  videoUrl: string | null
  likeCount: number
  collectCount: number
  commentCount: number
  /** 当前登录用户是否已点赞 */
  liked: boolean
  authorNickname: string
  authorAvatar: string | null
  /** 按上传顺序返回 */
  images: string[]
  createTime: string
}

/** 发布笔记请求体 */
export interface NotePublishDTO {
  title: string
  content: string
  type?: number
  imageUrls?: string[]
  videoUrl?: string
}

/** 上传单张图片的返回体 */
export interface ImageUploadVO {
  url: string
}
