package com.xiaoku.module.topic.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.support.NoteCounterStore;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.topic.entity.NoteTopicEntity;
import com.xiaoku.module.topic.entity.TopicEntity;
import com.xiaoku.module.topic.mapper.NoteTopicMapper;
import com.xiaoku.module.topic.mapper.TopicMapper;
import com.xiaoku.module.topic.service.TopicQueryService;
import com.xiaoku.module.topic.vo.TopicListVO;
import com.xiaoku.module.user.vo.UserVO;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.common.context.UserContextHolder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class TopicQueryServiceImpl implements TopicQueryService {

    private final TopicMapper topicMapper;
    private final NoteTopicMapper noteTopicMapper;
    private final NoteMapper noteMapper;
    private final NoteCounterStore counterStore;
    private final UserQueryService userQueryService;
    private final UserFollowQueryService userFollowQueryService;

    @Override
    public PageVO<TopicListVO> pageHotTopics(int page, int size) {
        long total = topicMapper.countTopics();
        long offset = (long) (page - 1) * size;
        var rows = topicMapper.pageHotTopics(offset, size);
        List<TopicListVO> list = rows.stream()
                .map(r -> TopicListVO.builder()
                        .id(r.getId())
                        .name(r.getName())
                        .description(r.getDescription())
                        // Integer 不是 Long：Long 会被雪花 ID 的 ToStringSerializer
                        // 序列化成字符串，前端 `count === 3` 恒为 false（同 P5 的坑）
                        .noteCount(Math.toIntExact(r.getNoteCount()))
                        .build())
                .toList();
        return PageVO.of(list, total, page, size);
    }

    @Override
    public PageVO<NoteListItemVO> pageTopicNotes(String topicName, int page, int size) {
        Long topicId = requireTopicId(topicName);
        Long myId = UserContextHolder.requireUserId();

        long total = noteTopicMapper.selectCount(Wrappers.<NoteTopicEntity>lambdaQuery()
                .eq(NoteTopicEntity::getTopicId, topicId));
        if (total == 0) {
            return PageVO.of(List.of(), 0, page, size);
        }
        // 分两段查而不是 JOIN + LIMIT：先按 idx_topic_note 取 note_id，
        // 再批量取笔记。JOIN 写法在 note 表上要过 filesort，
        // 而话题页天然只需要一页 20 条，先拿 id 反而更稳
        List<Long> noteIds = noteTopicMapper.selectList(Wrappers.<NoteTopicEntity>lambdaQuery()
                        .select(NoteTopicEntity::getNoteId)
                        .eq(NoteTopicEntity::getTopicId, topicId))
                .stream().map(NoteTopicEntity::getNoteId).toList();
        long offset = (long) (page - 1) * size;
        List<Long> pageIds = noteIds.stream().skip(offset).limit(size).toList();
        if (pageIds.isEmpty()) {
            return PageVO.of(List.of(), total, page, size);
        }
        List<NoteEntity> notes = noteMapper.selectList(Wrappers.<NoteEntity>lambdaQuery()
                .in(NoteEntity::getId, pageIds)
                .eq(NoteEntity::getStatus, 1));
        // 按传入顺序重排：IN 查询返回的顺序不保证与 noteIds 一致，
        // 而这个顺序来自 note_topic（谁先被加进这个话题），
        // 对话题页来说比「发布时间」更符合直觉
        Map<Long, NoteEntity> byId = new java.util.HashMap<>();
        notes.forEach(n -> byId.put(n.getId(), n));
        List<NoteEntity> ordered = pageIds.stream().map(byId::get).filter(java.util.Objects::nonNull).toList();

        List<Long> authorIds = ordered.stream().map(NoteEntity::getUserId).distinct().toList();
        Map<Long, UserVO> authors = userQueryService.findUserVOMap(authorIds);
        Set<Long> mine = userFollowQueryService.batchFollowingIds(myId, authorIds);
        counterStore.applyCounts(ordered);
        List<NoteListItemVO> voList = ordered.stream()
                .map(n -> NoteConverter.toListItemVO(n, authors.get(n.getUserId()),
                        mine.contains(n.getUserId())))
                .toList();
        return PageVO.of(voList, total, page, size);
    }

    @Override
    public Long requireTopicId(String topicName) {
        if (topicName == null || topicName.isBlank()) {
            throw new BizException(ErrorCodeEnum.TOPIC_NOT_FOUND);
        }
        // 允许前端传 '#咖啡' 或 '咖啡' —— 页面 URL 里带 # 会变成 fragment，
        // 所以两边都要能接受
        String name = topicName.startsWith("#") ? topicName.substring(1) : topicName;
        List<TopicEntity> topics = topicMapper.selectList(Wrappers.<TopicEntity>lambdaQuery()
                .eq(TopicEntity::getName, name)
                .last("LIMIT 1"));
        if (topics.isEmpty() || topics.get(0).getStatus() == TopicEntity.STATUS_DISABLED) {
            throw new BizException(ErrorCodeEnum.TOPIC_NOT_FOUND);
        }
        return topics.get(0).getId();
    }
}