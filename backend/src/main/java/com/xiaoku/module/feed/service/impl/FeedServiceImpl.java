package com.xiaoku.module.feed.service.impl;

import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.feed.mapper.FeedMapper;
import com.xiaoku.module.feed.service.FeedService;
import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.support.NoteCounterStore;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class FeedServiceImpl implements FeedService {

    private final FeedMapper feedMapper;
    private final UserQueryService userQueryService;
    private final NoteCounterStore counterStore;
    private final UserFollowQueryService userFollowQueryService;

    @Override
    public PageVO<NoteListItemVO> followFeed(int page, int size) {
        Long userId = UserContextHolder.requireUserId();

        long total = feedMapper.countFollowFeed(userId);
        long offset = (long) (page - 1) * size;
        return assemble(feedMapper.pageFollowFeed(userId, offset, size), total, page, size, userId);
    }

    @Override
    public PageVO<NoteListItemVO> discoverFeed(int page, int size) {
        Long userId = UserContextHolder.requireUserId();

        long total = feedMapper.countDiscover(userId);
        long offset = (long) (page - 1) * size;
        return assemble(feedMapper.pageDiscover(userId, offset, size), total, page, size, userId);
    }

    /**
     * 实体列表 → 卡片 VO 的公共装配（关注流与发现流共用）
     *
     * <p>一页的笔记可能来自多个作者，一次 IN 把作者都捞出来，避免逐篇查（N+1）；
     * 整页卡片计数以 Redis 为准（pipeline 一次往返），缺失的保持 DB 现值。
     *
     * <p>{@code authorFollowed} 一律按「我此刻是否关注了这位作者」的<b>实时判断</b>填，
     * 不靠列表来源推断：关注流取关后那一页可能仍留着旧关注关系（status 只是闲置列，
     * 关注/取关走物理删，所以 JOIN 本身是对的，但作者被逻辑删除时 findUserVOMap
     * 会缺条目）；发现流更是混着已关注与未关注两种作者。
     */
    private PageVO<NoteListItemVO> assemble(List<NoteEntity> notes, long total, int page, int size, Long viewerId) {
        if (notes.isEmpty()) {
            return PageVO.of(List.of(), total, page, size);
        }

        List<Long> authorIds = notes.stream().map(NoteEntity::getUserId).distinct().toList();
        Map<Long, UserVO> users = userQueryService.findUserVOMap(authorIds);
        Set<Long> mine = userFollowQueryService.batchFollowingIds(viewerId, authorIds);

        counterStore.applyCounts(notes);
        List<NoteListItemVO> voList = notes.stream()
                .map(note -> NoteConverter.toListItemVO(note, users.get(note.getUserId()),
                        mine.contains(note.getUserId())))
                .toList();

        return PageVO.of(voList, total, page, size);
    }
}