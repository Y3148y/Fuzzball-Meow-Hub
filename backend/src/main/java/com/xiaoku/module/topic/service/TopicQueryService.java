package com.xiaoku.module.topic.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.topic.vo.TopicListVO;

public interface TopicQueryService {

    /** 热门话题列表（按笔记数倒序） */
    PageVO<TopicListVO> pageHotTopics(int page, int size);

    /** 某个话题下的已发布笔记，按发布时间倒序 */
    PageVO<NoteListItemVO> pageTopicNotes(String topicName, int page, int size);

    /** 话题是否存在（不存在时给 70001，不静默返回空列表） */
    Long requireTopicId(String topicName);
}