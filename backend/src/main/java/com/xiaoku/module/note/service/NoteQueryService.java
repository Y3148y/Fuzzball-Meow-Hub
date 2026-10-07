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
