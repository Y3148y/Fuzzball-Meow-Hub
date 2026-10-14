package com.xiaoku.module.feed.service.impl;

import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.feed.mapper.FeedMapper;
import com.xiaoku.module.feed.service.FeedService;
import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.user.service.UserBlockService;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.support.NoteCounterStore;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import com.xiaoku.module.note.entity.NoteImageEntity;
import com.xiaoku.module.note.mapper.NoteImageMapper;
import com.xiaoku.module.note.vo.ImmerseCardVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class FeedServiceImpl implements FeedService {

    /** 正文摘要的长度上限（字符）。沉浸流卡片只有几行文字的位置，超了就没意义 */
    private static final int BRIEF_MAX = 120;

    private final FeedMapper feedMapper;
    private final UserQueryService userQueryService;
    private final NoteCounterStore counterStore;
    private final UserFollowQueryService userFollowQueryService;
    private final UserBlockService userBlockService;
    private final NoteImageMapper noteImageMapper;

    @Override
    public PageVO<NoteListItemVO> followFeed(int page, int size) {
        Long userId = UserContextHolder.requireUserId();

        // P18 黑名单：被拉黑作者的笔记不进我的两个流。
        // 过滤在 SQL 里做而不是查回来再筛 —— 否则 total 会和 list 对不上，
        // 分页会出现「明明 total=20 却只显示 18 条」
        Set<Long> hidden = userBlockService.hiddenUserIds(userId);
        long total = feedMapper.countFollowFeed(userId, hidden);
        long offset = (long) (page - 1) * size;
        return assemble(feedMapper.pageFollowFeed(userId, offset, size, hidden), total, page, size, userId);
    }

    @Override
    public PageVO<NoteListItemVO> discoverFeed(int page, int size) {
        Long userId = UserContextHolder.requireUserId();

        Set<Long> hidden = userBlockService.hiddenUserIds(userId);
        long total = feedMapper.countDiscover(userId, hidden);
        long offset = (long) (page - 1) * size;
        return assemble(feedMapper.pageDiscover(userId, offset, size, hidden), total, page, size, userId);
    }

    /**
     * 沉浸流（P34）
     *
     * <p>排序与 {@link #discoverFeed} <b>刻意复用同一个 mapper 方法</b>：
     * 两处排序若不一致，用户在首页看到的内容与滑到的内容会对不上，
     * 而「首页有但滑不到」极难归因 —— 宁可少写一遍 SQL 也不能有两套口径。
     */
    @Override
    public PageVO<ImmerseCardVO> immerseFeed(int page, int size) {
        Long userId = UserContextHolder.requireUserId();

        Set<Long> hidden = userBlockService.hiddenUserIds(userId);
        long total = feedMapper.countDiscover(userId, hidden);
        long offset = (long) (page - 1) * size;
        List<NoteEntity> notes = feedMapper.pageDiscover(userId, offset, size, hidden);
        if (notes.isEmpty()) {
            return PageVO.of(List.of(), total, page, size);
        }

        List<Long> authorIds = notes.stream().map(NoteEntity::getUserId).distinct().toList();
        Map<Long, UserVO> users = userQueryService.findUserVOMap(authorIds);
        Set<Long> mine = userFollowQueryService.batchFollowingIds(userId, authorIds);
        // 计数以 Redis 为准，与首页同一套（pipeline 一次往返）
        counterStore.applyCounts(notes);

        // ⚠️ **一次 IN 取全页的图**，不是逐篇查：沉浸流是「一直往下划」的形态，
        // 每划一屏多几次往返，手感上就是「偶尔卡一下」（543 篇里实测 1.4 张/篇，
        // 一页 6 条就是 6 次 vs 1 次的差别）。
        List<Long> noteIds = notes.stream().map(NoteEntity::getId).toList();
        Map<Long, List<String>> images = new HashMap<>();
        for (NoteImageEntity img : noteImageMapper.listByNoteIds(noteIds)) {
            images.computeIfAbsent(img.getNoteId(), k -> new ArrayList<>()).add(img.getUrl());
        }

        List<ImmerseCardVO> out = new ArrayList<>(notes.size());
        for (NoteEntity note : notes) {
            UserVO author = users.get(note.getUserId());
            // 视频笔记没有图（note.video_url 才是它的封面）；图文一定有图
            // （P11 起的规则：图文必须至少一张图）
            List<String> imgs = images.getOrDefault(note.getId(), List.of());
            out.add(ImmerseCardVO.builder()
                    .id(note.getId())
                    .type(note.getType())
                    .videoUrl(note.getVideoUrl())
                    .images(imgs)
                    .title(note.getTitle())
                    .contentBrief(brief(note.getContent()))
                    .likeCount(note.getLikeCount())
                    .collectCount(note.getCollectCount())
                    .commentCount(note.getCommentCount())
                    .authorId(note.getUserId())
                    .authorNickname(author == null ? "已注销用户" : author.getNickname())
                    .authorAvatar(author == null ? null : author.getAvatar())
                    .authorFollowed(mine.contains(note.getUserId()))
                    .createTime(note.getCreateTime())
                    .build());
        }
        return PageVO.of(out, total, page, size);
    }

    /** 正文摘要：压掉换行并限长。沉浸流卡片只有几行文字的位置 */
    private static String brief(String content) {
        if (content == null || content.isBlank()) {
            return null;
        }
        String s = content.replaceAll("\\s+", " ").strip();
        return s.length() <= BRIEF_MAX ? s : s.substring(0, BRIEF_MAX) + "…";
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