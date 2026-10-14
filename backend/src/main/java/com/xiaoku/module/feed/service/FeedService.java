package com.xiaoku.module.feed.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.note.vo.ImmerseCardVO;
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

    /**
     * 沉浸流（P34）：给「一屏一张、上下滑」那个页面喂数据
     *
     * <p>排序与 {@link #discoverFeed} **完全一致**（关注优先 → 热度 → 时间），
     * 刻意不另造一套：两处排序若不一致，用户在首页看到的内容与滑到的内容
     * 会对不上，而「首页有但滑不到」极难归因。
     *
     * <p>差异只在<b>返回什么</b>：带全部图片（卡内轮播）与正文摘要，
     * 而 {@code NoteListItemVO} 只有封面。
     *
     * @param page 页码，从 1 开始。沉浸流按「一条一页」消费，不需要游标
     * @param size 每页条数
     */
    PageVO<ImmerseCardVO> immerseFeed(int page, int size);
}