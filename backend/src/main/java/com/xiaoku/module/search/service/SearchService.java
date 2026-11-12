package com.xiaoku.module.search.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.note.vo.NoteListItemVO;

/**
 * 笔记搜索域。
 *
 * <p>职责：ES 检索 + MySQL 回填组卡。ES 只决定「哪些、什么顺序」，
 * 展示字段（作者昵称/计数/封面）一律以 DB 为准，见 {@code SearchServiceImpl}。
 */
public interface SearchService {

    /**
     * 全文搜索已发布笔记。
     *
     * @param keyword 搜索关键词，blank 时抛 50002
     * @param page    页码，从 1 开始
     * @param size    每页条数
     * @param type    P50 类型筛选：0 全部 / 1 图文 / 2 视频；其它值抛 100001
     * @param sort    P50 排序："synthesis" 综合（相关度优先）/ "latest" 最新；其它值抛 100001
     */
    PageVO<NoteListItemVO> searchNote(String keyword, int page, int size, int type, String sort);

    /**
     * 重建笔记索引：删掉旧索引 + 按 mapping 新建 + MySQL 全量回灌 status=1 的笔记。
     * 兜底/对账用（事件管道丢了数据、索引被误删都靠它拉回）。
     *
     * @return 本次回灌的文档数
     */
    int rebuildNoteIndex();
}