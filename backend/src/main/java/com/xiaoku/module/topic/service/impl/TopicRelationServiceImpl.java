package com.xiaoku.module.topic.service.impl;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.vo.NoteVO;
import com.xiaoku.module.topic.vo.TopicVO;
import com.xiaoku.module.topic.vo.MentionVO;
import com.xiaoku.module.notification.service.NotificationService;
import com.xiaoku.module.topic.entity.NoteMentionEntity;
import com.xiaoku.module.topic.entity.NoteTopicEntity;
import com.xiaoku.module.topic.entity.TopicEntity;
import com.xiaoku.module.topic.mapper.NoteMentionMapper;
import com.xiaoku.module.topic.mapper.NoteTopicMapper;
import com.xiaoku.module.topic.mapper.TopicMapper;
import com.xiaoku.module.topic.service.TopicRelationService;
import com.xiaoku.module.user.vo.UserVO;
import com.xiaoku.module.user.service.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 话题/提及的解析与落库
 *
 * <p><b>解析规则定在哪</b>：只在这里，且都写成了可单测的纯函数。发布页再写一遍
 * 前端预览的版本，就会出现「前端显示识别到 2 个话题、后端存了 1 个」这种
 * 永远查不出来的差异。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TopicRelationServiceImpl implements TopicRelationService {

    /**
     * 话题：{@code #} 后跟 1~20 个非空白、非 {@code #}、非 {@code @} 的字符
     *
     * <p>排除空白是因为 {@code # 有空格的标题} 不该被当成话题；
     * 排除 {@code #}{@code @} 是为了让「##话题」「#话题@某人」各自只算一个标记。
     *
     * <p>已知的宽松之处：{@code C#开发} 会被识别成话题「开发」。要严格就得
     * 上分词 + 语境判断，代价与收益不成比例（真实场景里带 {@code #} 的
     * C# 代码片段远少于正常的 {@code #话题}），所以这里选择宽松并写在这里。
     */
    /**
     * 话题：{@code #} 后跟 1~20 个<b>非空白、非 {@code #}、非 {@code @}、非分隔标点</b>的字符
     *
     * <p><b>标点必须排除，否则会解析出垃圾话题</b>。这是实测出来的：
     * 正文「还有一个 #很长很长的话题名字」如果允许逗号，就会解析出
     * 「很长很长的话题名字，和」这种把标点和后半个句子一起吞进去的话题 ——
     * 用户完全没意识到自己建了个含逗号的话题，而话题页会按这个名字聚笔记。
     * 排除的是「，,。.、;；!！?？:：」这类**中英文分隔标点**，
     * 但**不排除 - _ ~ / 空格以外的连接符**，因为「#iPhone」「#618大促」
     * 「#C++」这类是真实存在的写法。
     *
     * <p>排除空白是因为 {@code # 有空格的标题} 不该被当成话题；
     * 排除 {@code #}{@code @} 是为了让「##话题」「#话题@某人」各自只算一个标记。
     *
     * <p>已知的宽松之处：{@code C#开发} 会被识别成话题「开发」。要严格就得
     * 上分词 + 语境判断，代价与收益不成比例（真实场景里带 {@code #} 的
     * C# 代码片段远少于正常的 {@code #话题}），所以这里选择宽松并写在这里。
     */
    private static final Pattern TOPIC_PATTERN =
            Pattern.compile("#([^\\s#@\uFF0C\u002C\u3002\u002E\u3001\uFF1B\u003B\uFF01\u0021\uFF1F\u003F\uFF1A\u003A]{1,20})");

    /**
     * 提及：{@code @} 后跟 3~32 个字母数字下划线
     *
     * <p>3 位起是因为用户名最短 3 位（注册校验一致）；字符集与
     * {@code RegisterDTO} 的 {@code ^[a-zA-Z0-9_]+$} 保持一致，
     * 两处不一致就会出现「前端认为提到了人、后端解析不出来」。
     */
    private static final Pattern MENTION_PATTERN =
            Pattern.compile("@([a-zA-Z0-9_]{3,32})");

    /** 一篇笔记最多几个话题：再多就是标签堆砌，对读者没有价值 */
    public static final int MAX_TOPICS = 5;
    /** 一篇笔记最多提及几个人 */
    public static final int MAX_MENTIONS = 10;

    private final TopicMapper topicMapper;
    private final NoteTopicMapper noteTopicMapper;
    private final NoteMentionMapper noteMentionMapper;
    private final UserQueryService userQueryService;
    private final NotificationService notificationService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void replaceRelations(NoteEntity note, String title, String content) {
        Long noteId = note.getId();
        if (noteId == null) {
            return;
        }
        // 先清后插：编辑是全量覆盖语义，关系行跟着全量替换，
        // 免得「改了正文还留着旧话题」这种残留
        noteTopicMapper.delete(Wrappers.<NoteTopicEntity>lambdaQuery().eq(NoteTopicEntity::getNoteId, noteId));
        noteMentionMapper.delete(Wrappers.<NoteMentionEntity>lambdaQuery().eq(NoteMentionEntity::getNoteId, noteId));

        List<String> topicNames = extractTopicNames(title, content);
        List<Long> topicIds = ensureTopics(topicNames);
        for (Long topicId : topicIds) {
            NoteTopicEntity row = new NoteTopicEntity();
            row.setNoteId(noteId);
            row.setTopicId(topicId);
            noteTopicMapper.insert(row);
        }

        List<Long> mentionUserIds = resolveMentionUserIds(content, note.getUserId());
        for (Long userId : mentionUserIds) {
            NoteMentionEntity row = new NoteMentionEntity();
            row.setNoteId(noteId);
            row.setUserId(userId);
            noteMentionMapper.insert(row);
        }
        // 被@的人发「提我」通知。发在关系行之后：通知是 afterCommit + 吞异常的
        // （见 NotificationServiceImpl.push），所以失败不会影响发布。
        for (Long uid : mentionUserIds) {
            notificationService.notifyMention(uid, note.getUserId(), noteId, content);
        }

        log.info("笔记关系行已写入 noteId={} topics={} mentions={}",
                noteId, topicIds.size(), mentionUserIds.size());
    }

    /**
     * 从标题+正文里解析话题名（去重、保序、限长）
     *
     * <p>标题里的话题也算：小红书的习惯就是标题带 {@code #话题}。
     */
    public List<String> extractTopicNames(String title, String content) {
        // LinkedHashSet：去重且保序 —— 用户写 {@code #咖啡 #咖啡} 只算一个，
        // 而「先出现的排前面」让详情页的话题 chip 顺序符合直觉
        Set<String> names = new LinkedHashSet<>();
        collect(title, names);
        collect(content, names);
        List<String> out = new ArrayList<>(names);
        return out.size() > MAX_TOPICS ? out.subList(0, MAX_TOPICS) : out;
    }

    private void collect(String text, Set<String> sink) {
        if (text == null || text.isBlank()) {
            return;
        }
        Matcher m = TOPIC_PATTERN.matcher(text);
        while (m.find() && sink.size() < MAX_TOPICS) {
            sink.add(m.group(1).strip());
        }
    }

    /**
     * 解析并解析成真实用户 id
     *
     * <p>不存在的用户名安静忽略；自己@自己直接去掉（自己提醒自己没意义，
     * 而且会给「提我」通知发一条）。
     */
    public List<Long> resolveMentionUserIds(String content, Long authorId) {
        Set<String> names = new LinkedHashSet<>();
        if (content != null && !content.isBlank()) {
            Matcher m = MENTION_PATTERN.matcher(content);
            while (m.find() && names.size() < MAX_MENTIONS) {
                names.add(m.group(1));
            }
        }
        if (names.isEmpty()) {
            return List.of();
        }
        Map<String, Long> found = userQueryService.findIdsByUsernames(new ArrayList<>(names));
        List<Long> ids = new ArrayList<>();
        for (String n : names) {
            Long uid = found.get(n);
            if (uid != null && !uid.equals(authorId) && !ids.contains(uid)) {
                ids.add(uid);
            }
            if (ids.size() >= MAX_MENTIONS) {
                break;
            }
        }
        return ids;
    }

    /**
     * 话题不存在就建，存在就取 id
     *
     * <p>并发下靠 {@code INSERT IGNORE} + 唯一索引，不靠「先查再插」。
     */
    private List<Long> ensureTopics(List<String> names) {
        if (names.isEmpty()) {
            return List.of();
        }
        Map<String, TopicEntity> existing = new HashMap<>();
        for (TopicEntity t : topicMapper.selectByNames(names)) {
            existing.put(t.getName(), t);
        }
        List<Long> ids = new ArrayList<>();
        for (String name : names) {
            TopicEntity t = existing.get(name);
            if (t == null) {
                long newId = IdWorker.getId();
                topicMapper.insertIgnore(newId, name);
                // 重新查一次拿权威 id：并发下可能是别人刚插进去的，
                // 而 insertIgnore 返回值区分不出「我插的」还是「已存在」
                List<TopicEntity> now = topicMapper.selectByNames(List.of(name));
                if (now.isEmpty()) {
                    continue;
                }
                t = now.get(0);
            }
            if (t.getStatus() != null && t.getStatus() == TopicEntity.STATUS_DISABLED) {
                log.warn("话题被禁用，忽略：{}", name);
                continue;
            }
            if (!ids.contains(t.getId())) {
                ids.add(t.getId());
            }
        }
        return ids;
    }

    @Override
    public List<TopicVO> listTopics(Long noteId) {
        List<Long> ids = noteTopicMapper.selectTopicIds(noteId);
        if (ids.isEmpty()) {
            return List.of();
        }
        List<TopicEntity> topics = topicMapper.selectBatchIds(ids);
        Map<Long, TopicEntity> byId = new HashMap<>();
        topics.forEach(t -> byId.put(t.getId(), t));
        List<TopicVO> out = new ArrayList<>();
        for (Long id : ids) {
            TopicEntity t = byId.get(id);
            if (t != null) {
                out.add(TopicVO.builder().id(t.getId()).name(t.getName()).build());
            }
        }
        return out;
    }

    @Override
    public List<MentionVO> listMentions(Long noteId) {
        List<Long> userIds = noteMentionMapper.selectUserIds(noteId);
        if (userIds.isEmpty()) {
            return List.of();
        }
        Map<Long, UserVO> users = userQueryService.findUserVOMap(userIds);
        List<MentionVO> out = new ArrayList<>();
        for (Long id : userIds) {
            UserVO u = users.get(id);
            if (u != null) {
                out.add(MentionVO.builder().id(u.getId()).nickname(u.getNickname())
                        .username(u.getUsername()).build());
            }
        }
        return out;
    }

    @Override
    public void removeRelations(Long noteId) {
        noteTopicMapper.delete(Wrappers.<NoteTopicEntity>lambdaQuery().eq(NoteTopicEntity::getNoteId, noteId));
        noteMentionMapper.delete(Wrappers.<NoteMentionEntity>lambdaQuery().eq(NoteMentionEntity::getNoteId, noteId));
    }

    @Override
    public void applyRelations(List<NoteVO> noteVOs,
                               Map<Long, List<TopicVO>> topicMap,
                               Map<Long, List<MentionVO>> mentionMap) {
        for (NoteVO vo : noteVOs) {
            vo.setTopics(topicMap.getOrDefault(vo.getId(), List.of()));
            vo.setMentions(mentionMap.getOrDefault(vo.getId(), List.of()));
        }
    }

    /** 按 noteId 批量取话题，供列表页一次性灌入（避免 N+1） */
    public Map<Long, List<TopicVO>> topicsOfNotes(List<Long> noteIds) {
        if (noteIds == null || noteIds.isEmpty()) {
            return Map.of();
        }
        List<NoteTopicEntity> rows = noteTopicMapper.selectList(
                Wrappers.<NoteTopicEntity>lambdaQuery().in(NoteTopicEntity::getNoteId, noteIds));
        if (rows.isEmpty()) {
            return Map.of();
        }
        Set<Long> topicIds = new LinkedHashSet<>();
        rows.forEach(r -> topicIds.add(r.getTopicId()));
        Map<Long, TopicEntity> topics = new HashMap<>();
        topicMapper.selectBatchIds(topicIds).forEach(t -> topics.put(t.getId(), t));
        // LinkedHashMap + 按 noteId 分组：同一篇笔记的话题按关系行插入顺序返回，
        // 不会因为 HashMap 的无序而每次刷新顺序都变
        Map<Long, List<TopicVO>> grouped = new LinkedHashMap<>();
        for (NoteTopicEntity r : rows) {
            TopicEntity t = topics.get(r.getTopicId());
            if (t != null) {
                grouped.computeIfAbsent(r.getNoteId(), k -> new ArrayList<>())
                        .add(TopicVO.builder().id(t.getId()).name(t.getName()).build());
            }
        }
        return grouped;
    }

    /** 按 noteId 批量取提及，供列表页/详情页一次性灌入 */
    public Map<Long, List<MentionVO>> mentionsOfNotes(List<Long> noteIds) {
        if (noteIds == null || noteIds.isEmpty()) {
            return Map.of();
        }
        List<NoteMentionEntity> rows = noteMentionMapper.selectList(
                Wrappers.<NoteMentionEntity>lambdaQuery().in(NoteMentionEntity::getNoteId, noteIds));
        if (rows.isEmpty()) {
            return Map.of();
        }
        Set<Long> userIds = new LinkedHashSet<>();
        rows.forEach(r -> userIds.add(r.getUserId()));
        Map<Long, UserVO> users = userQueryService.findUserVOMap(userIds);
        Map<Long, List<MentionVO>> grouped = new LinkedHashMap<>();
        for (NoteMentionEntity r : rows) {
            UserVO u = users.get(r.getUserId());
            if (u != null) {
                grouped.computeIfAbsent(r.getNoteId(), k -> new ArrayList<>())
                        .add(MentionVO.builder().id(u.getId()).nickname(u.getNickname())
                        .username(u.getUsername()).build());
            }
        }
        return grouped;
    }
}