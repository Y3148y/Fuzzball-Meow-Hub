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
  // 30xxx 互动域（点赞 / 收藏 / 评论）
  NOTE_ALREADY_LIKED: 30001,
  NOTE_NOT_LIKED: 30002,
  NOTE_ALREADY_COLLECTED: 30003,
  NOTE_NOT_COLLECTED: 30004,
  COMMENT_NOT_FOUND: 30005,
  COMMENT_TOO_LONG: 30006,
  CANNOT_COMMENT_SELF_NOTE: 30007,
  // 评论点赞与笔记点赞共用 30001/30002，别名让调用处语义自明
  COMMENT_ALREADY_LIKED: 30001,
  COMMENT_NOT_LIKED: 30002,
  // 40xxx 关注域
  ALREADY_FOLLOWED: 40001,
  NOT_FOLLOWED: 40002,
  CANNOT_FOLLOW_SELF: 40003,
  // 50xxx 搜索域
SEARCH_SERVICE_ERROR: 50001,
  SEARCH_KEYWORD_EMPTY: 50002,
  // 80xxx 举报与黑名单域（P18）
  ALREADY_REPORTED: 80003,
  CANNOT_REPORT_SELF: 80004,
  ALREADY_BLOCKED: 80005,
  NOT_BLOCKED_YET: 80006,
  CANNOT_BLOCK_SELF: 80007,
  // 60xxx 内容审核域（P15）
  CONTENT_SENSITIVE: 60001,
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

/**
 * <b>后端配了 {@code default-property-inclusion: non_null}，
 * 所以「值为 null」在 JSON 里表现为「字段整个不存在」。</b>
 *
 * <p>也就是说你在这边看到的所有 {@code xxx: string | null}，
 * 运行时拿到的其实是 {@code undefined}，不是 {@code null}。
 * JSON 里长这样：
 * <pre>{ "id": "123", "avatar": null }   →  { "id": "123" }</pre>
 *
 * <p><b>因此判断「有没有值」必须用 {@code == null} 或真值判断，
 * 不能用 {@code === null}，也不能用 {@code 'avatar' in obj}。</b>
 * 同一个值在 TypeScript 里声明成 {@code | null} 只是为了提醒「这里可能没值」，
 * 模板里 {@code {{ user.avatar }}} 和 {@code v-if="user.avatar"} 两者表现一致，
 * 所以统一按这个风格写，不为了 undefined 再单独开一套 optional 类型。
 */
export type Nullable<T> = T | null

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
/**
 * 角色 0 普通用户 1 管理员（P20）
 *
 * ⚠️ 这只用于「我的」页决定要不要渲染运营后台入口，**不是安全边界** ——
 * 真权限在后端 AdminInterceptor。P20 之前这个字段不存在，
 * 是加在 likeReceivedCount 之后的；老账号后端返回 null 时按 0（非管理员）处理。
 */
role: number
/** 后端是 LocalDateTime，默认形如 "2026-09-23T10:58:35" */
createTime: string
}

/**
 * 修改个人资料的请求体，对应后端 UserProfileUpdateDTO。
 *
 * 字段全 optional：只传要改的，后端不会把没传的字段覆盖掉。
 * 上限要跟后端 @Size 对齐（昵称 32 / 简介 255），
 * 超了后端会回 100001，这里先拦一道省得白跑一趟。
 */
export type ProfilePatch = Partial<Pick<UserVO, 'nickname' | 'avatar' | 'bio' | 'gender'>>

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
  /** 1 已发布 2 已下架（作者视角可见草稿/下架态，P10）；非作者永远只能看到 1 */
  status: number
  title: string
  content: string
  cover: string | null
  videoUrl: string | null
  likeCount: number
  collectCount: number
  commentCount: number
  /** 当前登录用户是否已点赞 */
  liked: boolean
  /** 当前登录用户是否已收藏（P5 新增，和 liked 是两套独立关系） */
  collected: boolean
  /**
   * 作者 ID（P6 起暴露）。
   *
   * <p>以前刻意不返回 userId，是 P6 做「详情页直接关注作者」时反转的决定：
   * 没有它，关注按钮就得专门再发一个「查作者身份」的请求。
   * 和后端 NoteVO 的注释是一对，改这里记得一起去。
   */
  authorId: SnowflakeId
  /** 当前登录用户是否已关注作者。注意：null 字段会被 non_null 规则省略 */
  authorNickname: string
  authorAvatar: string | null
authorFollowed: boolean
  /** 按上传顺序返回 */
  images: string[]
  /** 正文里的 #话题，由后端解析后返回；前端不传（P16） */
  topics?: TopicVO[]
  /** 正文里的 @提及，被提到的人；详情页据此把 @昵称 渲染成链接（P16） */
  mentions?: MentionVO[]
  createTime: string
}

/** 话题引用 */
export interface TopicVO {
  id: SnowflakeId
  /** 不含 # */
  name: string
}

/** 被提及的用户 */
export interface MentionVO {
  id: SnowflakeId
  nickname: string
  /**
   * 被提及者的**用户名**
   *
   * 正文里写的是 `@xk_ui_follow`（用户名），页面上要显示的是昵称「关注搭子」，
   * 所以两个都得给：前端靠「昵称 + 用户名」两张表去正文里定位那一段文字，
   * 只给昵称的话整段 @提及 会渲染成纯文本，而**界面看不出任何异常**。
   */
  username?: string
}

/** 黑名单项 */
export interface BlockedUserVO {
  id: SnowflakeId
  username: string
  nickname: string
  avatar: Nullable<string>
  createTime: string
}

/** 话题列表项 */
export interface TopicListVO {
  id: SnowflakeId
  name: string
  description: Nullable<string>
  /** 该话题下已发布笔记数，后端实时统计 */
  noteCount: number
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

/**
 * 分页返回体，对应后端 PageVO。
 *
 * <p>total / page / size 是 <b>JSON number 不是字符串</b>。
 * 这不是随便定的：JacksonConfig 会把 Long 序列化成字符串（为了雪花 ID），
 * 而 PageVO 最初用 long 写 total，于是接口返回的是 {@code "1"}，
 * 前端 {@code total === 1} 恒为 false、分页器算不出总页数。
 * 改成 Integer 之后才是数字，所以 {@code page === 1} 可以直接用。
 */
export interface PageVO<T> {
  list: T[]
  total: number
  /** 从 1 开始 */
  page: number
  size: number
}

/** 一条评论，对应后端 CommentVO */
export interface CommentVO {
  id: SnowflakeId
  noteId: SnowflakeId
  nickname: string
  avatar: Nullable<string>
  content: string
  likeCount: number
  /**
   * 父评论 ID，一级评论为「无」。
   *
   * <p>后端数据库里用 0 当哨兵，但 {@code CommentConverter} 会把 0 转成
   * {@code null} 再输出——刻意不让前端看到 {@code "0"}：
   * 0 既可能被误当成合法 ID，又因为是 Long 而变成字符串，
   * 前端得写 {@code === '0'} 才能判断，而它<b>不能</b>用 {@code Number()}
   * 转（非零时是 17 位雪花 ID，一转就丢精度）。
   * 加上 non_null 省略规则，实际运行时这里是 {@code undefined}，
   * 所以判断一律用 {@code !comment.parentId}。
   */
  parentId: Nullable<SnowflakeId>
  /** 根评论 ID，一级评论为「无」，语义同 parentId */
  rootCommentId: Nullable<SnowflakeId>
  /** 被回复者昵称，非回复为「无」 */
  replyNickname: Nullable<string>
  /** 当前登录用户是否已点赞 */
  liked: boolean
  /** 是否是自己发的，前端据此显示删除按钮 */
  mine: boolean
  createTime: string
  /** 子回复列表，只有一级评论会带这个字段 */
  replies: CommentVO[]
  /**
   * 子回复<b>总数</b>，可能大于 {@code replies.length}。
   *
   * <p>后端每根评论最多返回 3 条子回复（MAX_REPLIES_PER_ROOT），
   * 所以要判断「还有更多回复」必须看这个字段，
   * 不能只看 {@code replies.length === 3}——正好 3 条时也会误判成有更多。
   */
  replyTotal: number
}

/** 发表评论请求体，对应后端 CommentCreateDTO */
export interface CommentCreateDTO {
  noteId: SnowflakeId
  content: string
  /** 回复某条评论时传，被回复的父评论 ID；发一级评论不传 */
  parentId?: SnowflakeId
}

/**
 * 关注 / 粉丝列表的用户行，以及作者主页卡片，对应后端 FollowUserVO。
 *
 * <p>等于 UserVO + followed。为什么不直接复用 UserVO：
 * followed 是「依赖当前浏览者」的视图态，每个看到这行的人结果不同，
 * 专门一个类型说清楚「这一行是给谁看的」。
 */
export interface FollowUserVO extends Omit<UserVO, 'followCount' | 'fansCount' | 'likeReceivedCount'> {
  followCount: number
  fansCount: number
  likeReceivedCount: number
  /** 当前登录用户是否已关注 TA */
  followed: boolean
}

/**
 * 笔记列表卡片（关注流 / 作者主页列表），对应后端 NoteListItemVO。
 *
 * <p>列表场景没有全文正文。authorFollowed 同样是人而异的视图态。
 */
export interface NoteListItemVO {
  id: SnowflakeId
  /** 1 图文 2 视频 */
  type: number
  title: string
  cover: string | null
  likeCount: number
  collectCount: number
  commentCount: number
  createTime: string
  authorId: SnowflakeId
  authorNickname: string
  authorAvatar: string | null
  authorFollowed: boolean
}

/** 通知列表项（铃铛 + 通知页） */
export interface NotificationVO {
  id: SnowflakeId
  /** 1赞笔记 2评论 3赞评论 4关注 5回复 */
  type: number
  /** 动作短语，如「赞了你的笔记」 */
  typeText: string
  actorId: SnowflakeId
  actorNickname: string
  actorAvatar: string | null
  /** 被作用的笔记ID或评论ID（按 type 决定跳哪里） */
  targetId: SnowflakeId
  /** 所属笔记ID；**关注类通知没有这个字段**（后端 non_null 策略会整个省略它） */
  noteId?: SnowflakeId
  /** 所属笔记标题；笔记被删或关注类通知时为 null（被 non_null 省略） */
  noteTitle?: string
  /** 评论/回复内容摘要 */
  content?: string
  /** 0未读 1已读 */
  isRead: 0 | 1
  createTime: string
}

/* ================================================================
 * 私信（P22）
 * ================================================================ */

/**
 * 单条私信
 *
 * <p>{@code isRead} 是「**收件人**有没有读过」而不是发送方的回执视角 ——
 * 小红书的「已读」是双向可见的那种语义；P22 只做接收侧。
 */
export interface MessageVO {
  id: SnowflakeId
  sessionId: SnowflakeId
  senderId: SnowflakeId
  receiverId: SnowflakeId
  content: string
  isRead: 0 | 1
  createTime: string
}

/**
 * 私信会话（会话列表的一行）
 *
 * <p>{@code unread} 是「**对方**发给我、我还没读」的条数 —— 与「我刚发的」
 * 无关，所以列表里出现一个会话不代表里面有未读。
 */
export interface MessageSessionVO {
  sessionId: SnowflakeId
  peerId: SnowflakeId
  /** 对方注销时后端回退成「已注销用户」，不会给 null */
  peerNickname: string
  peerAvatar: Nullable<string>
  /** 最后一条消息摘要；会话还没发过消息时是 undefined（non_null） */
  lastMessage?: string
  lastTime?: string
  unread: number
}
