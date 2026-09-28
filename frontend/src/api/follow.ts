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
 * 单个用户的关注状态（用户信息 + 当前登录者是否已关注），作者主页卡片用。
 * 和列表接口一样返回 FollowUserVO，但只给一个人，省得拿一页。
 */
export function getUserFollowStatus(userId: SnowflakeId) {
  return get<FollowUserVO>(`/follow/user/${userId}`)
}