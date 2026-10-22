package com.xiaoku.module.note.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.follow.vo.FollowUserVO;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.note.vo.NoteVO;

/**
 * 笔记读操作。
 */
public interface NoteQueryService {

    /**
     * 笔记详情。
     *
     * @param noteId 笔记ID
     * @return 详情（含图片列表、作者信息、是否已点赞/收藏/关注作者）
     * @throws com.xiaoku.common.exception.BizException 笔记不存在或已下架时抛
     */
    NoteVO getDetail(Long noteId);

    /**
     * 校验「这篇笔记对当前用户可见」，不可见时抛异常。
     *
     * <p><b>为什么要有这个方法</b>（P45）：评论能被单独按 id 读取
     * （{@code GET /api/comment/{id}}），而评论**总是挂在某篇笔记下面** ——
     * 所以取评论时必须连带校验「它所在的笔记对当前用户可见」，
     * 否则私密/下架笔记的评论能被任何人凭 id 读出来。
     *
     * <p><b>可见性规则只有这一份</b>：草稿 / 已下架 / 被拉黑 / 私密账号
     * 四种情况的判断都在 {@code NoteQueryServiceImpl.requireVisible} 里，
     * 这里只是把它暴露出去，避免在评论侧再写一份（漂移 = 私密内容泄露）。
     *
     * @param noteId   笔记 id
     * @param viewerId 当前浏览者
     * @throws com.xiaoku.common.exception.BizException 不可见时
     */
    void requireNoteVisible(Long noteId, Long viewerId);

    /**
     * 某用户发布过的笔记，分页（作者主页用）。
     *
     * <p>只返回已发布（status=1）的笔记，按发布时间倒序；
     * 作者注销（逻辑删除）返回 USER_NOT_FOUND。
     *
     * @param userId 作者ID
     */
    PageVO<NoteListItemVO> pageUserNotes(Long userId, int page, int size);

    /**
     * 我的收藏夹：当前登录用户收藏过的、仍处于已发布状态的笔记，按收藏时间倒序
     *
     * <p>只查自己的（不传 userId）：收藏夹是私有数据，别人收藏了什么不需要对外可见，
     * 也就没有「TA 收藏了」这种视图。
     *
     * @param page 页码，从 1 开始
     * @param size 每页条数
     */
    PageVO<NoteListItemVO> pageMyCollections(int page, int size);

    /**
     * 我赞过的笔记，按点赞时间倒序
     *
     * <p><b>同样不传 userId</b>，理由与收藏夹一模一样：「我赞过什么」是私有数据，
     * 能传 id 就等于允许越权遍历别人的点赞历史。
     * 也不提供「TA 赞过的笔记」这种视图 —— 小红书同样没有。
     *
     * @param page 页码，从 1 开始
     * @param size 每页条数
     */
    PageVO<NoteListItemVO> pageMyLikedNotes(int page, int size);

    /**
     * 谁赞了这篇笔记（点赞人列表，按点赞时间倒序）
     *
     * <p>「谁赞了」和「多少人赞了」是两件事：计数只有数字，社交感来自人名。
     * 数据本来就在 {@code note_like} 表里，P5 只做了计数方向，没做反向查询。
     */
    PageVO<FollowUserVO> pageLikers(Long noteId, int page, int size);

    /**
     * 谁收藏了这篇笔记（收藏人列表，按收藏时间倒序）
     *
     * <p>刻意<b>不做</b>「TA 收藏了哪些笔记」的公开查询：收藏夹是私有数据，
     * 对外暴露等于允许越权遍历他人收藏（P15 收藏夹的接口因此不收 userId）。
     */
    PageVO<FollowUserVO> pageCollectors(Long noteId, int page, int size);
}
