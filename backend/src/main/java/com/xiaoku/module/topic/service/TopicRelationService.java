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
     * 写正文的话题与提及关系行（全量替换）
     *
     * <p>「全量替换」而不是「增量 diff」：编辑一次笔记的正文是全量覆盖的语义
     * （P10 起就是），关系行跟着全量替换最不容易出「改了标题还留着旧话题」
     * 这种残留。行数本来就少（一篇最多 5 个话题、10 个提及），删了重插比 diff 便宜。
     *
     * <p><b>话题仍从文本解析，提及改由入参给（P30）</b>：
     * {@code #话题} 的名字天然唯一，解析文本没有歧义；而 @ 的是**昵称**，
     * 昵称允许重复，解析文本就必须在重名时挑一个 —— 而挑错人比不 @ 更糟
     * （通知发给了完全无关的人）。所以 @ 改由前端选择器提交 id：
     * <b>正文只是外观，id 才是事实</b>。
     *
     * @param note 已落库的笔记（需要 userId 做自提及过滤）
     * @param mentionUserIds 前端选人时确定的 @ 对象；null 视为「没 @ 任何人」
     */
    void replaceRelations(NoteEntity note, String title, String content, java.util.List<Long> mentionUserIds);

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

    /**
     * 写评论里的 @ 提及关系并给被提及者发通知（P29）。
     *
     * <p><b>为什么评论的 @ 以前完全没实现</b>：{@code note_mention} 表原本只有
     * {@code note_id}，没有「这条提及来自哪条评论」的位置，而 {@code listMentions}
     * 又只按 noteId 查。症状是用户反馈的「@ 对方后对方后台没有任何提示」——
     * 接口返回 200、页面看着一切正常，只是<strong>关系行与通知都没写</strong>。
     */
    void replaceCommentMentions(Long noteId, Long commentId, Long authorId, java.util.List<Long> mentionUserIds, String content);

    /** 删评论时清掉它的提及关系行（无外键不级联） */
    void removeCommentRelations(Long commentId);

    /** 批量取一批评论的提及，供评论列表渲染 @ 链接（避免 N+1） */
    java.util.Map<Long, List<MentionVO>> commentMentionMap(java.util.Collection<Long> commentIds);


}