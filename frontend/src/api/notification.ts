import { get, post } from './request'
import type { NotificationVO, Nullable, PageVO, SnowflakeId } from './types'

/**
 * 通知中心接口
 *
 * <p>排序由后端保证：**未读优先 → 时间倒序**，前端不要再自己排一遍。
 */

/** 通知列表；onlyUnread = true 时只看未读（铃铛页的「只看未读」筛选用） */
export function listNotifications(page = 1, size = 20, onlyUnread = false) {
  return get<PageVO<NotificationVO>>('/notification/list', { page, size, onlyUnread })
}

/**
 * 未读数（铃铛角标）
 *
 * <p>返回 **number** 不是 string：后端用 {@code Result<Integer>}，不能用 Long ——
 * Jackson 给 Long 注册了 ToStringSerializer，会把 0 变成 "0"，
 * 前端 {@code unread === 0} 就恒为 false（AGENTS 第 6 节同一个坑）。
 */
export function unreadCount() {
  return get<number>('/notification/unread-count')
}

/** 单条标已读；本来就读过或不归当前用户都返回 false（幂等，不报错） */
export function markRead(id: SnowflakeId) {
  return post<boolean>(`/notification/${id}/read`)
}

/** 全部已读，返回受影响条数 */
export function markAllRead() {
  return post<number>('/notification/read-all')
}

export type { NotificationVO, Nullable }