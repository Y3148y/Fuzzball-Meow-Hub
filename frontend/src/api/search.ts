import { get } from './request'
import type { NoteListItemVO, PageVO, UserPickVO } from './types'

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

/**
 * 「@ 提及」候选用户（P29）
 *
 * <p><b>为什么一个「搜索」接口放在 search.ts 而不是 user.ts</b>：
 * 它的路径是 {@code /search/user}，而且它服务的是「搜索」这个动作
 * （选人），不是「用户资料」。放 user.ts 会让人以为它返回完整 UserVO。
 *
 * <p><b>后端已排除</b>：自己、拉黑（双向）、已注销、已禁用。
 * 所以这里**不需要**再在前端过滤一遍 —— 两处过滤的规则一旦不同步，
 * 就会出现「候选里有但 @ 出去解析不出来」的鬼影，而界面看不出异常。
 */
export function searchMentionUsers(keyword: string, limit = 10) {
  return get<UserPickVO[]>('/search/user', { keyword, limit })
}