import { get } from './request'
import type { NoteListItemVO, PageVO, SnowflakeId } from './types'

/** 我关注的人的最新笔记（跟踪）。列表不带正文，只有卡片字段 */
export function getFollowFeed(page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>('/feed/follow', { page, size })
}

/**
 * 首页发现流（全站已发布笔记，**不含自己发的**）
 *
 * <p>排序：关注过的作者优先 → 互动量（赞+藏+评）→ 最新补位。
 * 存在的理由：关注流对「一条关注都没有的新用户」永远是空的，首页会一片空白。
 */
export function getDiscoverFeed(page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>('/feed/discover', { page, size })
}

/** 某作者的笔记列表，作者主页用 */
export function getUserNotes(userId: SnowflakeId, page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>(`/note/user/${userId}`, { page, size })
}