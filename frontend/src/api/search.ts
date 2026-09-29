import { get } from './request'
import type { NoteListItemVO, PageVO } from './types'

/**
 * 全文搜索已发布笔记。
 *
 * <p>后端只对 <b>标题（权重 2）+ 正文</b> 做 multi_match，
 * 结果按相关性与发布时间倒序；卡片字段由后端回 MySQL 现组装，保证昵称/计数不过期。
 * 第二个形参就是 query 参数本身（见 request.ts 约定），不要包一层 params。
 */
export function searchNotes(keyword: string, page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>('/search/note', { keyword, page, size })
}