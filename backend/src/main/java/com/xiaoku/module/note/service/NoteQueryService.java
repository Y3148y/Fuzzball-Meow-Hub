package com.xiaoku.module.note.service;

import com.xiaoku.common.result.PageVO;
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
}
