import { get, post } from './request'
import type { MessageSessionVO, MessageVO, PageVO, SnowflakeId } from './types'

/**
 * 私信接口（P22）
 *
 * <p>投递方式是**轮询**而不是 WebSocket：前端每 15s 拉一次
 * {@link unreadCount}。所以本模块没有任何「订阅」概念，
 * 将来接 WebSocket 时只需要在这层改，业务代码不动。
 */

/** 发送私信。对方拉黑了我时后端返 50004（message 不区分是谁拉黑了谁） */
export function sendMessage(toUserId: SnowflakeId, content: string) {
  return post<MessageVO>('/message/send', { toUserId, content }, { idempotent: true })
}

/**
 * 聊天记录，**按时间正序返回**（最早→最新）
 *
 * <p>后端在 SQL 里取「最新的 N 条」再翻正 —— 聊天记录要从最早往上滚，
 * 而数据库分页只能往后取。前端拿到的已经是正序，直接 render。
 */
export function messageHistory(withUserId: SnowflakeId, page = 1, size = 20) {
  return get<PageVO<MessageVO>>('/message/history', { withUserId, page, size })
}

/** 会话列表，按最后一条消息倒序 */
export function listSessions() {
  return get<MessageSessionVO[]>('/message/session/list')
}

/**
 * 总未读数（会话页角标）
 *
 * <p>返回 **number** 不是 string：后端用 {@code Result<Integer>}，
 * 不能用 Long —— Jackson 对 Long 注册了 ToStringSerializer，会把 0 变成 "0"，
 * 前端 {@code unread === 0} 就恒为 false（AGENTS 第 6 节同一个坑）。
 */
export function unreadCount() {
  return get<number>('/message/unread-count')
}

/**
 * 某个会话全部标已读，返回受影响条数；本来就是全已读时返回 0
 *
 * <p>对方 userId 走 **query** 而不是 body：这个端点没有请求体，
 * 而 {@code post} 的第二参是 data、第三参才是 axios config。
 */
export function readAllMessages(withUserId: SnowflakeId) {
  return post<number>('/message/read-all', undefined, { params: { withUserId } })
}