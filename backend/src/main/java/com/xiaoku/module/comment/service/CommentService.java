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

    /**
     * 点赞评论，返回点赞后的最新评论状态。
     *
     * <p>重复点赞抛 {@code ALREADY_LIKED}；已下架笔记的评论不可再点赞。
     */
    CommentVO like(Long commentId);

    /**
     * 取消点赞评论，返回取消后的最新评论状态。
     *
     * <p>未点赞时取消抛 {@code NOT_LIKED_YET}。刻意不做「笔记状态」门禁：
     * 点赞可以因为笔记下架而失效，但<b>撤销一个已有的赞</b>不涉及该语义。
     */
    CommentVO unlike(Long commentId);
}
