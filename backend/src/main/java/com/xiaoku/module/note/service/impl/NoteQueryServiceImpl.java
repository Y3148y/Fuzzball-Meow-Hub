package com.xiaoku.module.note.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.entity.NoteImageEntity;
import com.xiaoku.module.note.entity.NoteLikeEntity;
import com.xiaoku.module.note.entity.NoteCollectEntity;
import com.xiaoku.module.note.mapper.NoteImageMapper;
import com.xiaoku.module.note.mapper.NoteLikeMapper;
import com.xiaoku.module.note.mapper.NoteCollectMapper;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.service.NoteQueryService;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.note.vo.NoteVO;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

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
        if (status == STATUS_TAKEN_DOWN) {
            // 下架过说明这篇曾经公开过，明确告知「已下架」比装作不存在更准确
            throw new BizException(ErrorCodeEnum.NOTE_STATUS_ILLEGAL, "该笔记已被下架");
        }

        List<String> images = noteImageMapper.selectList(Wrappers.<NoteImageEntity>lambdaQuery()
                        .eq(NoteImageEntity::getNoteId, noteId)
                        .orderByAsc(NoteImageEntity::getSort))
                .stream()
                .map(NoteImageEntity::getUrl)
                .toList();

        boolean liked = noteLikeMapper.selectCount(Wrappers.<NoteLikeEntity>lambdaQuery()
                .eq(NoteLikeEntity::getUserId, currentUserId)
                .eq(NoteLikeEntity::getNoteId, noteId)) > 0;

        boolean collected = noteCollectMapper.selectCount(Wrappers.<NoteCollectEntity>lambdaQuery()
                .eq(NoteCollectEntity::getUserId, currentUserId)
                .eq(NoteCollectEntity::getNoteId, noteId)) > 0;

        // 自己是作者时恒为 false：40003 挡住了关注自己，这里同构地输出 false
        boolean authorFollowed = userFollowQueryService.isFollowing(currentUserId, note.getUserId());

        return NoteConverter.toVO(note, userQueryService.findUserVO(note.getUserId()), images,
                liked, collected, authorFollowed);
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
        Page<NoteEntity> result = noteMapper.selectPage(pageInfo,
                Wrappers.<NoteEntity>lambdaQuery()
                        .eq(NoteEntity::getUserId, userId)
                        .eq(NoteEntity::getStatus, STATUS_PUBLISHED)
                        .orderByDesc(NoteEntity::getCreateTime)
                        .orderByDesc(NoteEntity::getId));

        // 这一页全是同一个作者的笔记，authorFollowed 算一次即可
        boolean authorFollowed = userFollowQueryService.isFollowing(currentUserId, userId);
        List<NoteListItemVO> voList = result.getRecords().stream()
                .map(note -> NoteConverter.toListItemVO(note, author, authorFollowed))
                .toList();

        return PageVO.of(voList, result.getTotal(), Math.toIntExact(result.getCurrent()),
                    Math.toIntExact(result.getSize()));
    }
}