package com.xiaoku.module.feed.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.note.vo.NoteListItemVO;

/**
 * 信息流读侧。
 */
public interface FeedService {

    /**
     * 关注流：当前登录用户关注的作者们发布的、最新在前的笔记，分页。
     *
     * @param page 页码，从 1 开始
     * @param size 每页条数
     */
    PageVO<NoteListItemVO> followFeed(int page, int size);
}