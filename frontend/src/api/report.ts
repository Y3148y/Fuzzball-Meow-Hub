import { del, get, post } from './request'
import type { BlockedUserVO, NoteListItemVO, PageVO, SnowflakeId } from './types'

/** 举报原因（后端固定枚举，运营可改，不要写死在前端） */
export interface ReportReasonVO {
  code: number
  text: string
}

export function listReportReasons() {
  return get<ReportReasonVO[]>('/report/reasons')
}

/**
 * 举报一条笔记或评论
 *
 * @param targetType 1笔记 2评论
 * @param reasonCode 见 ReportReasonVO.code
 */
export function reportContent(
  targetType: 1 | 2,
  targetId: SnowflakeId,
  reasonCode: number,
  detail?: string,
) {
  return post<SnowflakeId>('/report', { targetType, targetId, reasonCode, detail })
}

/** 拉黑。只影响我的视野，不通知对方 */
export function blockUser(userId: SnowflakeId) {
  return post<void>(`/user/block/${userId}`)
}

/** 取消拉黑 */
export function unblockUser(userId: SnowflakeId) {
  return del<void>(`/user/block/${userId}`)
}

/** 我的黑名单 */
export function listBlockedUsers(page = 1, size = 20) {
  return get<PageVO<BlockedUserVO>>('/user/block/list', { page, size })
}

/** 举报弹窗里「要举报哪一条」的目标（本地从 TA 的笔记列表拼） */
export type ReportTarget = Pick<NoteListItemVO, 'id' | 'title'>