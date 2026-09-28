import { get } from './request'
import type { NoteListItemVO, PageVO, SnowflakeId } from './types'

/** 我关注的人的最新笔记（跟踪）。列表不带正文，只有卡片字段 */
export function getFollowFeed(page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>('/feed/follow', { page, size })
}

/** 某作者的笔记列表，作者主页用 */
export function getUserNotes(userId: SnowflakeId, page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>(`/note/user/${userId}`, { page, size })
}