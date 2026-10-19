import { get } from './request'
import type { ImmerseCardVO, NoteListItemVO, PageVO, SnowflakeId } from './types'

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

/**
 * 沉浸流（P34）：一屏一张、上下滑那个页面
 *
 * <p>排序与 {@link getDiscoverFeed} **一致**（后端复用同一个 mapper），
 * 但每条带**全部图片**与正文摘要 —— 卡片要在卡内轮播，
 * 而 {@code NoteListItemVO} 只有封面。
 *
 * <p>默认 size=6：一次渲染一整屏卡片，拉太多会同时下载上百张图。
 */
export function immerseFeed(page = 1, size = 6) {
  return get<PageVO<ImmerseCardVO>>('/feed/immerse', { page, size })
}

/** 某作者的笔记列表，作者主页用 */
export function getUserNotes(userId: SnowflakeId, page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>(`/note/user/${userId}`, { page, size })
}
/** 我的收藏夹：当前登录用户收藏过的、仍已发布的笔记，按收藏时间倒序 */
export function getMyCollections(page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>('/note/collections', { page, size })
}

/**
 * 我赞过的笔记（个人主页的「赞过」Tab）。
 *
 * ⚠️ 刻意**不收 userId**：与收藏夹同源的理由 ——
 * 「我赞过什么」是私有数据，能传 id 就等于允许越权遍历别人的点赞历史。
 * 后端也不提供「TA 赞过的笔记」这种视图。
 */
export function getMyLiked(page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>('/note/liked', { page, size })
}
