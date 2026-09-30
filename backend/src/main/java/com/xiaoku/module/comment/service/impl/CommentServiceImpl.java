package com.xiaoku.module.comment.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.module.comment.converter.CommentConverter;
import com.xiaoku.module.comment.dto.CommentCreateDTO;
import com.xiaoku.module.comment.entity.CommentEntity;
import com.xiaoku.module.comment.entity.CommentLikeEntity;
import com.xiaoku.module.comment.mapper.CommentLikeMapper;
import com.xiaoku.module.comment.mapper.CommentMapper;
import com.xiaoku.module.comment.service.CommentQueryService;
import com.xiaoku.module.comment.service.CommentService;
import com.xiaoku.module.comment.vo.CommentVO;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.user.service.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class CommentServiceImpl implements CommentService {

    /** 约定的"无父评论 / 无被回复者"哨兵值，与 schema 的 DEFAULT 0 一致 */
    private static final long NO_PARENT = 0L;

    /** 与 NoteInteractionServiceImpl 一致：只有正常状态的笔记能互动 */
    private static final int STATUS_PUBLISHED = 1;

    private final CommentMapper commentMapper;
    private final CommentLikeMapper commentLikeMapper;
    private final NoteMapper noteMapper;
    private final UserQueryService userQueryService;
    private final CommentQueryService commentQueryService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public CommentVO create(CommentCreateDTO dto) {
        Long userId = UserContextHolder.requireUserId();
        Long noteId = parseId(dto.getNoteId(), "笔记ID");

        NoteEntity note = noteMapper.selectById(noteId);
        if (note == null) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        // 和 NoteInteractionServiceImpl.requireLikeableNote 保持同一套判断。
        // 之前只查了点赞/收藏的状态，漏了评论，结果「已下架的笔记仍能收到评论」，
        // 而它的 comment_count 还在涨——两个接口的语义不一致就是这种漏改出来的
        if (note.getStatus() == null || note.getStatus() != STATUS_PUBLISHED) {
            throw new BizException(ErrorCodeEnum.NOTE_STATUS_ILLEGAL, "该笔记当前状态不支持评论");
        }
        // 兑现 P0 就定好的规则：不能评论自己的笔记
        if (note.getUserId().equals(userId)) {
            throw new BizException(ErrorCodeEnum.CANNOT_COMMENT_SELF_NOTE);
        }

        CommentEntity comment = new CommentEntity();
        comment.setNoteId(noteId);
        comment.setUserId(userId);
        comment.setContent(dto.getContent().trim());
        comment.setLikeCount(0);

        if (dto.getParentId() == null || dto.getParentId().isBlank()) {
            comment.setRootCommentId(NO_PARENT);
            comment.setParentId(NO_PARENT);
            comment.setReplyUserId(NO_PARENT);
        } else {
            CommentEntity parent = requireComment(parseId(dto.getParentId(), "父评论ID"), noteId);
            // 两层封顶：回复"回复的回复"会被拉平成挂在同一个根评论下。
            // 再往深就会出现"回复的回复的回复"这种没人看得懂的楼中楼，
            // 而无限层级对存储和渲染都是负担
            comment.setRootCommentId(parent.getRootCommentId() == null || parent.getRootCommentId() == NO_PARENT
                    ? parent.getId()
                    : parent.getRootCommentId());
            comment.setParentId(parent.getId());
            comment.setReplyUserId(parent.getUserId());
        }

        commentMapper.insert(comment);
        noteMapper.increaseCommentCount(noteId);

        return CommentConverter.toVO(comment,
                userQueryService.findUserVO(userId),
                comment.getReplyUserId() == NO_PARENT ? null : userQueryService.findUserVO(comment.getReplyUserId()),
                false, true, null, null);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void delete(Long commentId) {
        Long userId = UserContextHolder.requireUserId();

        CommentEntity comment = commentMapper.selectById(commentId);
        // 别人的评论一律按"不存在"处理：返回 30005 而不是"没权限"，
        // 否则用户能靠错误码差异确认某条评论是否存在
        if (comment == null || !userId.equals(comment.getUserId())) {
            throw new BizException(ErrorCodeEnum.COMMENT_NOT_FOUND);
        }

        boolean isRoot = comment.getRootCommentId() == null || comment.getRootCommentId() == NO_PARENT;

        // 删根评论要连子树一起删：子回复脱离父评论没有意义，
        // 留着会成为查不到上下文的孤儿行。
        //
        // 注意 countChildren 必须在 delete **之前**算：先删了就永远数出 0，
        // 计数会少退。踩过这个顺序问题。
        int children = isRoot ? countChildren(commentId) : 0;
        if (isRoot && children > 0) {
            commentMapper.delete(Wrappers.<CommentEntity>lambdaQuery()
                    .eq(CommentEntity::getRootCommentId, commentId));
        }
        commentMapper.deleteById(commentId);

        // 一条 SQL 退掉"自己 + 子回复"的总和，不要循环调多次
        noteMapper.decreaseCommentCount(comment.getNoteId(), -(children + 1));
    }

    /**
     * 防重策略与笔记点赞同构：<b>只 insert，让唯一索引当裁判</b>，
     * 不写「先 select 再 insert」——那是 check-then-act 竞态，
     * 并发下两条会同时看到「还没点过」然后结果依赖索引加锁。
     * 这边和 {@code NoteInteractionServiceImpl.like} 的取舍完全一致。
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public CommentVO like(Long commentId) {
        Long userId = UserContextHolder.requireUserId();
        requireLikeableComment(commentId);

        CommentLikeEntity like = new CommentLikeEntity();
        like.setUserId(userId);
        like.setCommentId(commentId);
        try {
            commentLikeMapper.insert(like);
        } catch (DuplicateKeyException e) {
            throw new BizException(ErrorCodeEnum.ALREADY_LIKED);
        }
        // 评论量级远比笔记小，计数不走 Redis，直接行上 +1（见 CommentMapper 注释）
        commentMapper.increaseLikeCount(commentId);
        return commentQueryService.getOne(commentId);
    }

    /**
     * 取消页面刻意不做「笔记状态」门禁：点赞可以因为笔记下架而不再生效，
     * 但<b>撤销</b>一个没点掉的赞不依赖笔记状态，永远允许。
     * 这也回避了笔记点赞那个「下架后取消连带回滚」的坑——末尾的
     * {@code getOne} 不检查笔记状态，不会把已执行的删除一起回滚。
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public CommentVO unlike(Long commentId) {
        Long userId = UserContextHolder.requireUserId();
        // 确认评论存在本身：不存在时 delete 永远 0 行，得把「从未点赞」和
        // 「评论根本不存在」分开，才不误导前端
        requireCommentExists(commentId);

        int deleted = commentLikeMapper.delete(Wrappers.<CommentLikeEntity>lambdaQuery()
                .eq(CommentLikeEntity::getUserId, userId)
                .eq(CommentLikeEntity::getCommentId, commentId));
        if (deleted == 0) {
            throw new BizException(ErrorCodeEnum.NOT_LIKED_YET);
        }
        commentMapper.decreaseLikeCount(commentId);
        return commentQueryService.getOne(commentId);
    }

    /**
     * 点赞前确认评论属于一篇状态正常（status=1）的笔记。
     *
     * <p>和 {@code create} 同一个理由：给已下架笔记的评论点赞没有意义，
     * 而且「评论永远存在只是笔记下架了」这个状态不该被子回复的赞顶上去。
     */
    private void requireLikeableComment(Long commentId) {
        CommentEntity comment = commentMapper.selectById(commentId);
        if (comment == null) {
            throw new BizException(ErrorCodeEnum.COMMENT_NOT_FOUND);
        }
        NoteEntity note = noteMapper.selectById(comment.getNoteId());
        if (note == null || note.getStatus() == null || note.getStatus() != STATUS_PUBLISHED) {
            throw new BizException(ErrorCodeEnum.NOTE_STATUS_ILLEGAL, "该笔记当前状态不支持点赞评论");
        }
    }

    private void requireCommentExists(Long commentId) {
        if (commentMapper.selectById(commentId) == null) {
            throw new BizException(ErrorCodeEnum.COMMENT_NOT_FOUND);
        }
    }

    private int countChildren(Long rootCommentId) {
        return Math.toIntExact(commentMapper.selectCount(Wrappers.<CommentEntity>lambdaQuery()
                .eq(CommentEntity::getRootCommentId, rootCommentId)));
    }

    /**
     * 确认父评论存在、且属于同一篇笔记。
     *
     * <p>跨笔记回复必须拦：否则 A 笔记的评论可以挂到 B 笔记下，
     * 两篇笔记的评论数会互相污染。
     */
    private CommentEntity requireComment(Long commentId, Long noteId) {
        CommentEntity parent = commentMapper.selectById(commentId);
        if (parent == null || !parent.getNoteId().equals(noteId)) {
            throw new BizException(ErrorCodeEnum.COMMENT_NOT_FOUND);
        }
        return parent;
    }

    /**
     * 把前端传来的 ID 字符串转成 Long。
     *
     * <p>用 {@code parseLong} 而不是 {@code valueOf}：后者收到非数字会抛
     * {@code NumberFormatException}，被全局异常处理器兜成 100999 系统繁忙，
     * 语义完全不对。这里显式转成参数校验错误。
     */
    private Long parseId(String raw, String field) {
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException e) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, field + "格式不正确");
        }
    }
}
