package com.xiaoku.module.note.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.support.NoteIdBloomFilter;
import com.xiaoku.module.follow.converter.FollowConverter;
import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.follow.vo.FollowUserVO;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.entity.NoteCollectEntity;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.entity.NoteImageEntity;
import com.xiaoku.module.note.entity.NoteLikeEntity;
import com.xiaoku.module.note.mapper.NoteCollectMapper;
import com.xiaoku.module.note.mapper.NoteImageMapper;
import com.xiaoku.module.note.mapper.NoteLikeMapper;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.service.NoteQueryService;
import com.xiaoku.module.note.support.NoteCounterStore;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.note.vo.NoteVO;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class NoteQueryServiceImpl implements NoteQueryService {

    /** 0 草稿 1 正常 2 已下架 */
    private static final int STATUS_DRAFT = 0;
    private static final int STATUS_PUBLISHED = 1;
    private static final int STATUS_TAKEN_DOWN = 2;

    private final NoteMapper noteMapper;
    private final NoteImageMapper noteImageMapper;
    private final NoteLikeMapper noteLikeMapper;
    private final NoteCollectMapper noteCollectMapper;
    private final UserQueryService userQueryService;
    private final UserFollowQueryService userFollowQueryService;
    private final NoteIdBloomFilter bloomFilter;
    private final NoteCounterStore counterStore;

    /**
     * <b>笔记详情需要登录。</b>
     *
     * <p>社区产品做到游客可读详情是合理需求，但 MvcConfig 的白名单是
     * <b>精确路径</b>匹配（excludePathPatterns），而这里是 {@code /api/note/{id}}，
     * 带路径变量无法用常量写进白名单。要放行就得改成 {@code /api/note/*} 之类的前缀匹配，
     * 那会同时让<b>发布/上传</b>等写接口的语义变模糊，代价是削弱
     * 「默认全部需要登录，白名单只是收紧的口子」这条原则。
     * 所以 P3 保持需要登录；真要做游客可读，应当作为一次明确的策略变更单独评估。
     */
    @Override
    public NoteVO getDetail(Long noteId) {
        Long currentUserId = UserContextHolder.requireUserId();

        // 布隆过滤：id 一定不存在时，不碰缓存和 MySQL 直接返回 20001。
        // 这就是防穿透的全部意义——把「扫 ID」请求挡在数据访问层之前。
        // mightContain 在未回灌完成 / Redis 异常时恒返回 true（放行），见类的实现注释。
        if (!bloomFilter.mightContain(noteId)) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }

        NoteEntity note = requireVisible(noteId, currentUserId);

        List<String> images = noteImageMapper.selectList(Wrappers.<NoteImageEntity>lambdaQuery()
                        .eq(NoteImageEntity::getNoteId, noteId)
                        .orderByAsc(NoteImageEntity::getSort))
                .stream()
                .map(NoteImageEntity::getUrl)
                .toList();

        // P8：互动状态优先读 Redis（ZSCORE），Redis 答不了（key 缺失 / 连不上）
        // 才回退 DB——「缓存丢了」绝不等于「没点过」，见 NoteCounterStore。
        Boolean likedR = counterStore.isLiked(noteId, currentUserId);
        boolean liked = likedR != null
                ? likedR
                : noteLikeMapper.selectCount(Wrappers.<NoteLikeEntity>lambdaQuery()
                        .eq(NoteLikeEntity::getUserId, currentUserId)
                        .eq(NoteLikeEntity::getNoteId, noteId)) > 0;

        Boolean collectedR = counterStore.isCollected(noteId, currentUserId);
        boolean collected = collectedR != null
                ? collectedR
                : noteCollectMapper.selectCount(Wrappers.<NoteCollectEntity>lambdaQuery()
                        .eq(NoteCollectEntity::getUserId, currentUserId)
                        .eq(NoteCollectEntity::getNoteId, noteId)) > 0;

        // 自己是作者时恒为 false：40003 挡住了关注自己，这里同构地输出 false
        boolean authorFollowed = userFollowQueryService.isFollowing(currentUserId, note.getUserId());

        NoteVO vo = NoteConverter.toVO(note, userQueryService.findUserVO(note.getUserId()), images,
                liked, collected, authorFollowed);
        // 计数以 Redis 为准；key 缺失（被驱逐/清库/多实例分发）时回退「DB 关系行的实时数」，
        // 不能回退 note.like_count 列——那是异步落库的产物，最多滞后 30s，
        // 详情页拿滞后值会对不上「刚点赞完的 +1」。
        Long likeCount = counterStore.likeCount(noteId);
        if (likeCount == null) {
            likeCount = noteLikeMapper.selectCount(Wrappers.<NoteLikeEntity>lambdaQuery()
                    .eq(NoteLikeEntity::getNoteId, noteId));
        }
        Long collectCount = counterStore.collectCount(noteId);
        if (collectCount == null) {
            collectCount = noteCollectMapper.selectCount(Wrappers.<NoteCollectEntity>lambdaQuery()
                    .eq(NoteCollectEntity::getNoteId, noteId));
        }
        vo.setLikeCount(Math.toIntExact(likeCount));
        vo.setCollectCount(Math.toIntExact(collectCount));
        return vo;
    }

    @Override
    public PageVO<NoteListItemVO> pageUserNotes(Long userId, int page, int size) {
        Long currentUserId = UserContextHolder.requireUserId();

        // 目标不存在（含逻辑删除）直接 10001，否则「TA 没有笔记」和「TA 不存在」无法区分
        UserVO author = userQueryService.findUserVO(userId);
        if (author == null) {
            throw new BizException(ErrorCodeEnum.USER_NOT_FOUND);
        }

        Page<NoteEntity> pageInfo = new Page<>(page, size);
        var query = Wrappers.<NoteEntity>lambdaQuery()
                .eq(NoteEntity::getUserId, userId)
                .orderByDesc(NoteEntity::getCreateTime)
                .orderByDesc(NoteEntity::getId);
        // 本人主页 = 「我的笔记」管理视图，草稿/下架的也要能看到；
        // 他人主页 = 公开视图，只展示已发布。否则作者会发现自己
        // 「下架后就再也没法从列表进自己的笔记」。
        if (!currentUserId.equals(userId)) {
            query.eq(NoteEntity::getStatus, STATUS_PUBLISHED);
        }
        Page<NoteEntity> result = noteMapper.selectPage(pageInfo, query);

        // 这一页全是同一个作者的笔记，authorFollowed 算一次即可
        boolean authorFollowed = userFollowQueryService.isFollowing(currentUserId, userId);
        // P8：整页卡片计数以 Redis 为准（pipeline 一次往返），缺失的保持 DB 现值
        counterStore.applyCounts(result.getRecords());
        List<NoteListItemVO> voList = result.getRecords().stream()
                .map(note -> NoteConverter.toListItemVO(note, author, authorFollowed))
                .toList();

        return PageVO.of(voList, result.getTotal(), Math.toIntExact(result.getCurrent()),
                    Math.toIntExact(result.getSize()));
    }

    /**
     * 我的收藏夹
     *
     * <p>这一页的作者**不固定**（收藏夹里是别人的笔记），所以
     * {@code authorFollowed} 得逐篇实时判断 —— 与发现流同一个道理，
     * 不能拿「出现在收藏夹里」推断关注状态。
     */
    @Override
    public PageVO<NoteListItemVO> pageMyCollections(int page, int size) {
        Long myId = UserContextHolder.requireUserId();

        long total = noteCollectMapper.countCollectedNotes(myId);
        long offset = (long) (page - 1) * size;
        List<NoteEntity> notes = noteCollectMapper.pageCollectedNotes(myId, offset, size);
        if (notes.isEmpty()) {
            return PageVO.of(List.of(), total, page, size);
        }

        List<Long> authorIds = notes.stream().map(NoteEntity::getUserId).distinct().toList();
        Map<Long, UserVO> authors = userQueryService.findUserVOMap(authorIds);
        Set<Long> mine = userFollowQueryService.batchFollowingIds(myId, authorIds);

        counterStore.applyCounts(notes);
        List<NoteListItemVO> voList = notes.stream()
                .map(note -> NoteConverter.toListItemVO(note, authors.get(note.getUserId()),
                        mine.contains(note.getUserId())))
                .toList();

        return PageVO.of(voList, total, page, size);
    }

    /**
     * 取笔记并按 P3 门禁校验当前用户能不能看。
     *
     * <p><b>为什么抽出来</b>：点赞人/收藏人列表也是「这篇笔记的读取入口」，
     * 如果它们各自写一份门禁，迟早有一处漏 —— 结果就是「下架的笔记，
     * 正文打不开，但点赞人列表能拿到昵称头像」，等于门禁只做了一半。
     * 与 {@link #getDetail} 共用同一份实现，门禁才只有一个修改点。
     */
    private NoteEntity requireVisible(Long noteId, Long currentUserId) {
        NoteEntity note = noteMapper.selectById(noteId);
        if (note == null) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        boolean isAuthor = currentUserId.equals(note.getUserId());
        int status = note.getStatus() == null ? STATUS_PUBLISHED : note.getStatus();
        if (status == STATUS_DRAFT && !isAuthor) {
            // 草稿对非作者按「不存在」处理：返回「笔记不存在」而不是「这是草稿」，
            // 否则就能靠错误码差异探测出某篇草稿是否存在。
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        if (status == STATUS_TAKEN_DOWN && !isAuthor) {
            // 下架过说明这篇曾经公开过，明确告知「已下架」比装作不存在更准确。
            // 作者本人可见自己的下架笔记（P10「明明是自己的，却突然 404」的编辑入口
            // 需要它），这是与 P3 门禁的唯一差异。
            throw new BizException(ErrorCodeEnum.NOTE_STATUS_ILLEGAL, "该笔记已被下架");
        }
        return note;
    }

    @Override
    public PageVO<FollowUserVO> pageLikers(Long noteId, int page, int size) {
        Long myId = UserContextHolder.requireUserId();
        requireVisible(noteId, myId);
        var p = noteLikeMapper.selectPage(new Page<>(page, size), Wrappers.<NoteLikeEntity>lambdaQuery()
                .eq(NoteLikeEntity::getNoteId, noteId)
                .orderByDesc(NoteLikeEntity::getCreateTime)
                .orderByDesc(NoteLikeEntity::getId));
        return toUserCards(p.getRecords().stream().map(NoteLikeEntity::getUserId).toList(),
                myId, p.getTotal(), page, size);
    }

    @Override
    public PageVO<FollowUserVO> pageCollectors(Long noteId, int page, int size) {
        Long myId = UserContextHolder.requireUserId();
        requireVisible(noteId, myId);
        var p = noteCollectMapper.selectPage(new Page<>(page, size),
                Wrappers.<NoteCollectEntity>lambdaQuery()
                        .eq(NoteCollectEntity::getNoteId, noteId)
                        .orderByDesc(NoteCollectEntity::getCreateTime)
                        .orderByDesc(NoteCollectEntity::getId));
        return toUserCards(p.getRecords().stream().map(NoteCollectEntity::getUserId).toList(),
                myId, p.getTotal(), page, size);
    }

    /**
     * 一批 userId → 用户卡 +「我有没有关注 TA」。
     *
     * <p>和 {@code UserFollowQueryServiceImpl.toVO} 是同一套逻辑（两个 IN 查询，
     * 避免 N+1）。这里没有直接复用那个私有方法：它在 follow 模块内且签名绑定了
     * {@code UserFollowEntity} 的行提取，两处各自 12 行好过让 follow 模块
     * 为了复用公开一个只为本模块服务的泛型辅助。
     *
     * <p>逻辑删除的用户会被 {@code findUserVOMap} 漏掉，这里直接跳过而不是塞 null：
     * 给一行只有头像空白的卡片比不显示更糟。
     */
    private PageVO<FollowUserVO> toUserCards(List<Long> userIds, Long viewerId,
                                            long total, int page, int size) {
        if (userIds.isEmpty()) {
            return PageVO.of(List.of(), total, page, size);
        }
        Map<Long, UserVO> users = userQueryService.findUserVOMap(userIds);
        Set<Long> following = userFollowQueryService.batchFollowingIds(viewerId, userIds);
        List<FollowUserVO> cards = new ArrayList<>();
        for (Long id : userIds) {
            UserVO user = users.get(id);
            if (user != null) {
                cards.add(FollowConverter.toVO(user, following.contains(id)));
            }
        }
        return PageVO.of(cards, total, page, size);
    }
}