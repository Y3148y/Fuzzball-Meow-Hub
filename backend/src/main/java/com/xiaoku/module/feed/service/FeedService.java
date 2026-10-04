package com.xiaoku.module.feed.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.note.vo.NoteListItemVO;

/**
 * 信息流读侧。
 */
public interface FeedService {

/**
     * 关注流：当前登录用户关注的作者发布的笔记，按发布时间倒序分页
     *
     * @param page 页码，从 1 开始
     * @param size 每页条数
     */
    PageVO<NoteListItemVO> followFeed(int page, int size);

    /**
     * 发现流：全站已发布笔记（<b>排除自己发的</b>），供首页第二个 tab 用
     *
     * <p>排序：关注优先 → 互动量（赞+藏+评）→ 最新补位。
     * 详见 {@code FeedMapper.pageDiscover} 的注释（互动量列是异步落库产物）。
     *
     * @param page 页码，从 1 开始
     * @param size 每页条数
     */
    PageVO<NoteListItemVO> discoverFeed(int page, int size);
}