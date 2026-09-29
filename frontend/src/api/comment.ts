import { del, get, post } from './request'
import type { CommentCreateDTO, CommentVO, PageVO } from './types'

/**
 * 评论模块接口。
 * 路径对应后端 CommentController 的 @RequestMapping("/api/comment")。
 */

/**
 * 拉取某篇笔记的评论。
 *
 * <b>只分页一级评论</b>：后端把两级以内的回复都拉平挂到同一个根评论下，
 * 所以 {@code total} 是「一级评论条数」，不是「所有评论条数」——
 * 拿它当总评论数会算错分页总页数。
 *
 * <p>每根一级评论带 {@code replies}（最多 3 条）和 {@code replyTotal}（真实总数）。
 * 判断「还有更多回复」要用 {@code replyTotal > replies.length}，
 * 不能只看 {@code replies.length === 3}，因为正好 3 条时两者相等。
 *
 * <p>注意 {@code get} 的第二个形参<b>就是</b> query 参数本身
 * （{@code get(url, params, config)}），不是 axios 的 config。
 * 写成 {@code get(url, { params: {...} })} 的话 axios 会把整个对象
 * 当成一个 query 参数序列化出来，发出 {@code ?params[noteId]=...}，
 * 后端收到的是「缺少必要参数：noteId」——而且本地完全看不出问题。
 */
export function listComments(noteId: string, page = 1, size = 10) {
  return get<PageVO<CommentVO>>('/comment/list', { noteId, page, size })
}

/** 发表一级评论。不传 parentId 即可。开了幂等：同一次发送重发只落一条 */
export function createComment(data: CommentCreateDTO) {
  return post<CommentVO>('/comment', data, { idempotent: true })
}

/** 回复某条评论。parentId 传被回复的那条评论 ID */
export function replyComment(noteId: string, content: string, parentId: string) {
  return post<CommentVO>('/comment', { noteId, content, parentId }, { idempotent: true })
}

/** 删除评论。删根评论会连它的子树一起删 */
export function deleteComment(id: string) {
  return del<void>(`/comment/${id}`)
}
