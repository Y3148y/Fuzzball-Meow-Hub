package com.xiaoku.module.topic.service;

import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.vo.NoteVO;
import com.xiaoku.module.topic.vo.MentionVO;
import com.xiaoku.module.topic.vo.TopicVO;

import java.util.List;
import java.util.Map;

/**
 * 话题与提及：解析、全量替换写入、以及随笔记一起读取
 *
 * <p>「解析」而不是「让前端传数组」是刻意的：话题就是正文里的 {@code #xxx}，
 * 提及就是 {@code @昵称}。让客户端另外传一份 id 列表，就得同时信任两处内容，
 * 而且客户端传错了前端列表和正文就对不上（正文里的 #话题 没高亮、
 * 或者高亮了却没关联到任何话题）。**正文是唯一事实来源。**
 */
public interface TopicRelationService {

    /**
     * 解析正文里的 #话题 与 @提及，并全量写入关系行
     *
     * <p>「全量替换」而不是「增量 diff」：编辑一次笔记的正文是全量覆盖的语义
     * （P10 起就是），关系行跟着全量替换最不容易出「改了标题还留着旧话题」
     * 这种残留。行数本来就少（一篇最多 5 个话题、10 个提及），删了重插比 diff 便宜。
     *
     * @param note 已落库的笔记（需要 userId 做自提及过滤）
     */
    void replaceRelations(NoteEntity note, String title, String content);

    /** 笔记的话题（id + name），给 NoteVO 用 */
    List<TopicVO> listTopics(Long noteId);

    /** 笔记提及了谁（id + nickname），给 NoteVO 用 */
    List<MentionVO> listMentions(Long noteId);

    /** 笔记删除时清关系行（无外键，不级联） */
    void removeRelations(Long noteId);

    /**
     * 给 VOs 批量灌话题/提及（列表页一笔笔记一次 IN 查询，避免 N+1）
     *
     * @param noteVOs 笔记列表
     * @param topicMap noteId → 该笔记的话题
     * @param mentionMap noteId → 该笔记的提及
     */
    void applyRelations(List<NoteVO> noteVOs,
                        java.util.Map<Long, List<TopicVO>> topicMap,
                        java.util.Map<Long, List<MentionVO>> mentionMap);


}