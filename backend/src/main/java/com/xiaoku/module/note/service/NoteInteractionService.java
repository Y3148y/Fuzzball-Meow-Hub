package com.xiaoku.module.note.service;

import com.xiaoku.module.note.vo.NoteVO;

/**
 * 点赞 / 收藏这类"关系型互动"的写操作。
 *
 * <p>刻意与 {@link NoteService} 分开：点赞的核心难点不是 CRUD，
 * 而是<b>并发下不重复、不丢计数</b>，和发布笔记的校验逻辑没有交集。
 */
public interface NoteInteractionService {

    /**
     * 点赞。
     *
     * @return 最新的笔记计数（liked=true），前端直接替换显示，省一次详情请求
     */
    NoteVO like(Long noteId);

    /**
     * 取消点赞。
     *
     * <p>取消一条不存在的点赞返回 30002 而不是静默成功 ——
     * 静默成功会让前端以为"确实取消了"，而实际上计数没动。
     */
    NoteVO unlike(Long noteId);

    /** 收藏，语义同 {@link #like} */
    NoteVO collect(Long noteId);

    /** 取消收藏，语义同 {@link #unlike} */
    NoteVO uncollect(Long noteId);
}
