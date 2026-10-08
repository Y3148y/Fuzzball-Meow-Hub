import { get, post, put } from './request'
import type { PageVO, SnowflakeId } from './types'

/* ==================== 运营管理后台 ==================== */

/** 运营视角的举报行：被举报内容与举报人摊平到同一层 */
export interface AdminReportVO {
  id: SnowflakeId
  /** 1 笔记 2 评论 */
  targetType: number
  targetId: SnowflakeId
  reasonCode: number
  reasonText: string | null
  detail: string | null
  /** 0 待处理 1 已受理 2 已驳回 */
  status: number
  handleNote: string | null
  reporterNickname: string | null
  reporterUsername: string | null
  /** 被举报笔记的标题；评论无标题。内容已删除时为 null */
  targetTitle: string | null
  /** ⚠️ 这是**作者**，不是举报人。名字相近，拼错就是处置错的人 */
  targetAuthorNickname: string | null
  targetAuthorId: SnowflakeId | null
  targetContent: string | null
  /** false = 内容已经不存在（作者自己删了 / 被前一次处置删了），此时应当驳回 */
  targetExists: boolean
  createTime: string
}

/** 运营视角的用户行 */
export interface AdminUserItemVO {
  id: SnowflakeId
  username: string
  nickname: string
  bio: string | null
  /** 0 禁用 1 正常 */
  status: number
  /** 0 普通用户 1 管理员 */
  role: number
  noteCount: number
  /** 被举报次数：运营判断「是不是惯犯」最直接的依据 */
  reportCount: number
  createTime: string
}

/** 运营视角的笔记行。刻意不含 liked / authorFollowed —— 运营不是读者 */
export interface AdminNoteItemVO {
  id: SnowflakeId
  authorId: SnowflakeId
  authorNickname: string | null
  authorUsername: string | null
  title: string | null
  /** 服务端截断到 100 字 */
  content: string | null
  /** 1 图文 2 视频 */
  type: number
  /** 0 草稿 1 发布 2 下架 */
  status: number
  cover: string | null
  videoUrl: string | null
  likeCount: number
  collectCount: number
  commentCount: number
  reportCount: number
  createTime: string
}

/** 处置动作（与后端 ReportAction 同枚举） */
export const REPORT_ACTIONS = [
  { action: 1, label: '驳回', hint: '认为举报不成立，不动内容' },
  { action: 2, label: '下架笔记', hint: '内容下线，作者可自行改好再上架' },
  { action: 3, label: '删除笔记', hint: '内容级联删除，不可恢复' },
  { action: 4, label: '禁用作者', hint: '账号级处置，用于反复发违规内容' },
] as const

export function pendingReportCount() {
  return get<number>('/admin/report/pending-count')
}

export function listAdminReports(params: { status?: number; targetType?: number; page?: number; size?: number }) {
  return get<PageVO<AdminReportVO>>('/admin/report/list', params)
}

/**
 * 处置一条举报
 *
 * 不可重放：已处置过的再处置后端返 90003。所以按钮点完要立刻禁用，
 * 否则用户连点两下会看到第二个报错弹窗，而那不是失败、只是重复。
 */
export function handleReport(id: SnowflakeId, action: number, handleNote?: string) {
  return post<void>(`/admin/report/${id}/handle`, { action, handleNote })
}

export function listAdminUsers(params: { keyword?: string; status?: number; page?: number; size?: number }) {
  return get<PageVO<AdminUserItemVO>>('/admin/user/list', params)
}

export function changeUserStatus(id: SnowflakeId, status: 0 | 1) {
  return put<void>(`/admin/user/${id}/status`, { status })
}

export function listAdminNotes(params: {
  keyword?: string
  status?: number
  type?: number
  page?: number
  size?: number
}) {
  return get<PageVO<AdminNoteItemVO>>('/admin/note/list', params)
}

export function forceNoteStatus(id: SnowflakeId, status: 1 | 2) {
  return put<void>(`/admin/note/${id}/status`, { status })
}