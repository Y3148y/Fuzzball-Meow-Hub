import { get } from './request'
import type { NoteListItemVO, PageVO, TopicListVO } from './types'

/** 热门话题（按已发布笔记数倒序；数量由后端实时统计） */
export function listHotTopics(page = 1, size = 20) {
  return get<PageVO<TopicListVO>>('/topic/list', { page, size })
}

/**
 * 某个话题下的笔记
 *
 * @param name 话题名，**不带** #（带 # 也能被后端接受，但 URL 里 # 是 fragment 分隔符，
 *            编码过去很难读，所以前端一律传裸名）
 */
export function listTopicNotes(name: string, page = 1, size = 20) {
  return get<PageVO<NoteListItemVO>>('/topic/notes', { name, page, size })
}