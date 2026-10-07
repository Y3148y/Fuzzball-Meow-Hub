import { del, get, put } from './request'
import type { FollowUserVO, PageVO, SnowflakeId } from './types'

/** 关注 TA。返回的最新状态（status 40301-40303 相关错误码走拦截器提示） */
export function followUser(userId: SnowflakeId) {
  return put<FollowUserVO>(`/follow/${userId}`)
}

/** 取关。重复取关后端会回 40002，拦截器对动态数据专利会弹提示 */
export function unfollowUser(userId: SnowflakeId) {
  return del<FollowUserVO>(`/follow/${userId}`)
}

/** 某用户的关注列表，每行带「当前登录者是否已关注」 */
export function listFollowings(userId: SnowflakeId, page = 1, size = 20) {
  return get<PageVO<FollowUserVO>>('/follow/followings', { userId, page, size })
}

/** 某用户的粉丝列表，语义同上 */
export function listFans(userId: SnowflakeId, page = 1, size = 20) {
  return get<PageVO<FollowUserVO>>('/follow/fans', { userId, page, size })
}

/**
 * 某位用户的关注状态（TA 的信息 + 我有没有关注 TA），列表页卡片和作者页都要用，
 * 不想为一个卡片往返一次
 */
export function getUserFollowStatus(userId: SnowflakeId) {
  return get<FollowUserVO>(`/follow/user/${userId}`)
}

/**
 * 谁赞了这篇笔记（按点赞时间倒序）
 *
 * <p>与「多少人赞了」的区别：计数只有数字，看到人名才有社交感。
 * 数据本来就在库里，之前只做了计数方向，没做反向查询。
 */
export function listNoteLikers(noteId: SnowflakeId, page = 1, size = 20) {
  return get<PageVO<FollowUserVO>>(`/note/${noteId}/likes`, { page, size })
}

/** 谁收藏了这篇笔记（按收藏时间倒序） */
export function listNoteCollectors(noteId: SnowflakeId, page = 1, size = 20) {
  return get<PageVO<FollowUserVO>>(`/note/${noteId}/collects`, { page, size })
}