package com.xiaoku.module.comment.service;

import com.xiaoku.module.comment.dto.CommentCreateDTO;
import com.xiaoku.module.comment.vo.CommentVO;

/** 评论写操作 */
public interface CommentService {

    /**
     * 发表评论（可带 parentId 回复他人）。
     *
     * <p>不允许评论自己的笔记（{@code CANNOT_COMMENT_SELF_NOTE}）——
     * 这个规则是 P0 就在错误码里定好的，接口要兑现它而不是另立规矩。
     */
    CommentVO create(CommentCreateDTO dto);

    /**
     * 删除评论。
     *
     * <p>只有评论作者能删。删一级评论会连带删掉它的全部子回复，
     * 因为子回复脱离父评论没有意义。
     */
    void delete(Long commentId);
}
