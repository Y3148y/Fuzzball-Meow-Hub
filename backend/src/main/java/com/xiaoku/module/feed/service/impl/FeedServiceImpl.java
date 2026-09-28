package com.xiaoku.module.feed.service.impl;

import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.feed.mapper.FeedMapper;
import com.xiaoku.module.feed.service.FeedService;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class FeedServiceImpl implements FeedService {

    private final FeedMapper feedMapper;
    private final UserQueryService userQueryService;

    @Override
    public PageVO<NoteListItemVO> followFeed(int page, int size) {
        Long userId = UserContextHolder.requireUserId();

        long total = feedMapper.countFollowFeed(userId);
        long offset = (long) (page - 1) * size;
        List<NoteEntity> notes = feedMapper.pageFollowFeed(userId, offset, size);
        if (notes.isEmpty()) {
            return PageVO.of(List.of(), total, page, size);
        }

        // 一页的笔记可能来自多个作者，一次 IN 把作者都捞出来，避免逐篇查（N+1）
        List<Long> authorIds = notes.stream().map(NoteEntity::getUserId).distinct().toList();
        Map<Long, UserVO> users = userQueryService.findUserVOMap(authorIds);

        // 能出现在关注流里的作者 = 用户仍在关注，authorFollowed 恒为 true，
        // 但作者可能刚被逻辑删除（findUserVOMap 里没有），行回退成「已注销用户」
        List<NoteListItemVO> voList = notes.stream()
                .map(note -> NoteConverter.toListItemVO(note, users.get(note.getUserId()), true))
                .toList();

        return PageVO.of(voList, total, page, size);
    }
}