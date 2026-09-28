package com.xiaoku.module.note.service;

import com.xiaoku.module.note.vo.NoteVO;

/**
 * 笔记读操作。
 */
public interface NoteQueryService {

    /**
     * 笔记详情。
     *
     * @param noteId 笔记ID
     * @return 详情（含图片列表、作者信息、是否已点赞）
     * @throws com.xiaoku.common.exception.BizException 笔记不存在或已下架时抛
     */
    NoteVO getDetail(Long noteId);
}
