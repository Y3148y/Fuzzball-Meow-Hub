package com.xiaoku.module.comment.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.comment.dto.CommentCreateDTO;
import com.xiaoku.module.comment.vo.CommentVO;

/** 评论读操作 */
public interface CommentQueryService {

    /**
     * 按笔记分页查评论，返回<b>一级评论 + 各自的子回复</b>。
     *
     * <p>刻意不把回复也塞进分页里：分页语义是"对评论列表翻页"，
     * 如果子回复也参与翻页，用户翻两页会看到重复的子回复。
     * 现在是一级评论分页，每页的每条自带全部子回复。
     */
    PageVO<CommentVO> listByNote(Long noteId, int page, int size);

    /**
     * 查单条评论（点赞/取消点赞后回填最新状态用）。
     *
     * <p>不存在的评论抛 {@code COMMENT_NOT_FOUND}，和写接口的语义对齐。
     */
    CommentVO getOne(Long commentId);
}
