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

    /**
     * 按 id 查一条评论，<b>并校验它所在的笔记对当前用户可见</b>（P45）。
     *
     * <p><b>为什么需要它</b>：评论总是挂在某篇笔记下面。
     * 运营从举报后台点进「被举报的那条评论」时要按评论 id 取它 ——
     * 而这条评论可能挂在<b>私密账号</b>的笔记下面（只有关注了 TA 的运营能看），
     * 也可能挂在<b>已下架</b>的笔记下面。
     * 不校验的话，任何登录用户拿到一个评论 id 就能读出那些评论。
     *
     * <p>可见性规则复用 {@code NoteQueryService.requireNoteVisible}
     * ——<b>只有一份实现</b>，不在评论侧再写一遍（漂移 = 私密内容泄露）。
     *
     * @throws com.xiaoku.common.exception.BizException 评论不存在，或它所在的笔记不可见
     */
    CommentVO getVisibleOne(Long commentId);
}
