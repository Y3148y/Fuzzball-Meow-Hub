package com.xiaoku.module.comment.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.xiaoku.common.context.LoginUser;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.comment.converter.CommentConverter;
import com.xiaoku.module.comment.entity.CommentEntity;
import com.xiaoku.module.comment.entity.CommentLikeEntity;
import com.xiaoku.module.comment.mapper.CommentLikeMapper;
import com.xiaoku.module.comment.mapper.CommentMapper;
import com.xiaoku.module.comment.service.CommentQueryService;
import com.xiaoku.module.comment.vo.CommentVO;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.service.NoteQueryService;
import com.xiaoku.module.note.support.PrivacyGate;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class CommentQueryServiceImpl implements CommentQueryService {

    /**
     * 一级评论下最多带多少条子回复。
     *
     * <p>超过的不返回，但会把总数放进 {@code replyTotal}，
     * 前端据此显示"查看全部 x 条回复"。
     * 刻意不做「点开某条评论看全部回复」的接口：P5 的评论量级下
     * 一条评论最多几十条回复，全量返回也不至于撑爆响应；
     * 真出现超长楼中楼再补分页接口，届时 {@code replyTotal} 已经能
     * 直接当页大小用，不用改契约。
     */
    private static final int MAX_REPLIES_PER_ROOT = 3;

    private final CommentMapper commentMapper;
    private final CommentLikeMapper commentLikeMapper;
    private final NoteMapper noteMapper;
    /** P45：取单条评论时校验它所在的笔记是否可见（可见性规则只有这一份） */
    private final NoteQueryService noteQueryService;
    private final UserQueryService userQueryService;
    private final com.xiaoku.module.topic.service.TopicRelationService topicRelationService;
    /** P44 私密账号可见性闸门（与笔记详情共用同一份） */
    private final PrivacyGate privacyGate;

    @Override
    public PageVO<CommentVO> listByNote(Long noteId, int page, int size) {
        // 查评论前先确认笔记存在，否则会给一篇不存在的笔记返回 0 条评论——
        // 「这篇笔记确实没评」和「这篇笔记不存在」无法区分
        NoteEntity note = noteMapper.selectById(noteId);
        if (note == null) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        // P44：**私密账号**的笔记，其评论列表也不该给无权限的人看。
        //
        // ⚠️ 用的是**与笔记详情同一份**可见性闸门（PrivacyGate）——
        //    两处各判一次的话，规则迟早漂移，而漂移的方向是私密内容泄露。
        //
        // ⚠️ 这里**只拦私密**，不拦「已下架」：已下架笔记的评论列表任何人都能列，
        //    那是既有的产品口径（评论没有下架这个状态），别顺手改掉。
        Long viewerId = UserContextHolder.requireUserId();
        if (privacyGate.isHidden(note.getUserId(), viewerId)) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }

        Page<CommentEntity> pageInfo = new Page<>(page, size);
        // 只分页一级评论（root_comment_id = 0），子回复挂在每条下面
        Page<CommentEntity> roots = commentMapper.selectPage(pageInfo,
                Wrappers.<CommentEntity>lambdaQuery()
                        .eq(CommentEntity::getNoteId, noteId)
                        .eq(CommentEntity::getRootCommentId, 0L)
                        .orderByAsc(CommentEntity::getCreateTime)
                        .orderByAsc(CommentEntity::getId));

        List<CommentEntity> rootList = roots.getRecords();
        if (rootList.isEmpty()) {
            return PageVO.of(List.of(), roots.getTotal(), page, size);
        }

        List<Long> rootIds = rootList.stream().map(CommentEntity::getId).toList();
        List<CommentEntity> replies = commentMapper.selectList(Wrappers.<CommentEntity>lambdaQuery()
                .eq(CommentEntity::getNoteId, noteId)
                .in(CommentEntity::getRootCommentId, rootIds)
                .orderByAsc(CommentEntity::getCreateTime)
                .orderByAsc(CommentEntity::getId));

        // 本次要渲染的所有评论（根 + 子），一次性把作者和被回复者捞出来
        List<CommentEntity> all = new ArrayList<>(rootList);
        all.addAll(replies);

        Long currentUserId = currentUserId();
        Set<Long> likedIds = loadLikedIds(currentUserId, all.stream().map(CommentEntity::getId).toList());

        Map<Long, UserVO> users = userQueryService.findUserVOMap(all.stream()
                .flatMap(c -> java.util.stream.Stream.of(c.getUserId(), c.getReplyUserId()))
                .filter(Objects::nonNull)
                .filter(id -> id != 0L)
                .toList());

        Map<Long, List<CommentEntity>> repliesByRoot = replies.stream()
                .collect(Collectors.groupingBy(CommentEntity::getRootCommentId));

        // P29：一次捞出这批评论里的 @ 提及，避免逐条查的 N+1。
        // 只查**会被渲染出来**的那些（根 + 前 N 条子回复），
        // 多查的子回复只是白费一次 IN 里的几行。
        List<CommentEntity> shownChildren = replies.stream()
                .filter(c -> repliesByRoot.getOrDefault(c.getRootCommentId(), List.of()).stream()
                        .limit(MAX_REPLIES_PER_ROOT)
                        .anyMatch(x -> x.getId().equals(c.getId())))
                .toList();
        Map<Long, List<com.xiaoku.module.topic.vo.MentionVO>> mentionMap =
                topicRelationService.commentMentionMap(java.util.stream.Stream
                        .concat(rootList.stream(), shownChildren.stream())
                        .map(CommentEntity::getId)
                        .toList());

        List<CommentVO> voList = rootList.stream()
                .map(root -> {
                    List<CommentEntity> children = repliesByRoot.getOrDefault(root.getId(), List.of());
                    // 子回复只带前 N 条，多出来的靠 replyTotal 告诉前端还有多少
                    List<CommentVO> childVOs = children.stream()
                            .limit(MAX_REPLIES_PER_ROOT)
                            .map(c -> toVO(c, users, likedIds, currentUserId, null, null, mentionMap))
                            .toList();
                    return toVO(root, users, likedIds, currentUserId, childVOs, children.size(), mentionMap);
                })
                .toList();

        return PageVO.of(voList, roots.getTotal(), page, size);
    }

    @Override
    public CommentVO getOne(Long commentId) {
        CommentEntity comment = commentMapper.selectById(commentId);
        if (comment == null) {
            throw new BizException(ErrorCodeEnum.COMMENT_NOT_FOUND);
        }
        Long currentUserId = currentUserId();
        boolean mine = currentUserId != null && currentUserId.equals(comment.getUserId());
        boolean liked = currentUserId != null && commentLikeMapper.selectCount(Wrappers.<CommentLikeEntity>lambdaQuery()
                .eq(CommentLikeEntity::getUserId, currentUserId)
                .eq(CommentLikeEntity::getCommentId, commentId)) > 0;
        UserVO replyTo = comment.getReplyUserId() == null || comment.getReplyUserId() == 0L
                ? null
                : userQueryService.findUserVO(comment.getReplyUserId());
return CommentConverter.toVO(comment,
                userQueryService.findUserVO(comment.getUserId()),
                replyTo, liked, mine, null, null,
                topicRelationService.commentMentionMap(List.of(commentId)).get(commentId));
    }

    /**
     * 按 id 查一条评论，并校验它所在的笔记对当前用户可见（P45）。
     *
     * <p>⚠️ **刻意与 {@link #getOne(Long)} 分开**：
     * getOne 被 like/unlike 的响应回填调用，而 unlike **刻意**允许笔记已下架时撤销
     * （否则会把已执行的删除一起回滚 —— 见 CommentServiceImpl#unlike 的注释）。
     * 给 getOne 加门禁就会破坏那条语义。
     */
    @Override
    public CommentVO getVisibleOne(Long commentId) {
        CommentEntity comment = commentMapper.selectById(commentId);
        if (comment == null) {
            throw new BizException(ErrorCodeEnum.COMMENT_NOT_FOUND);
        }
        // 评论可见 ⟺ 它所在的笔记可见（草稿/下架/被拉黑/私密账号）
        // ⚠️ 不可见时报 20001「笔记不存在」而不是「评论不存在」：
        //    后者会让人知道「有个评论在不可见的笔记下面」。
        noteQueryService.requireNoteVisible(comment.getNoteId(), currentUserId());
        return getOne(commentId);
    }

    /** 评论读接口也要求登录，但这里是软读：拿不到登录态就当"没人点过赞"，不该 500 */
    private Long currentUserId() {
        LoginUser loginUser = UserContextHolder.get();
        return loginUser == null ? null : loginUser.getUserId();
    }

    private CommentVO toVO(CommentEntity entity, Map<Long, UserVO> users, Set<Long> likedIds,
                           Long currentUserId, List<CommentVO> replies, Integer replyTotal,
                           Map<Long, List<com.xiaoku.module.topic.vo.MentionVO>> mentionMap) {
        UserVO replyTo = entity.getReplyUserId() == null || entity.getReplyUserId() == 0L
                ? null
                : users.get(entity.getReplyUserId());
        boolean liked = likedIds.contains(entity.getId());
        boolean mine = currentUserId != null && currentUserId.equals(entity.getUserId());
        return CommentConverter.toVO(entity, users.get(entity.getUserId()), replyTo, liked, mine,
                replies, replyTotal, mentionMap == null ? null : mentionMap.get(entity.getId()));
    }

    /**
     * 一次性查出当前用户在这批评论里点过赞的。
     *
     * <p>不这么做就是「每条评论查一次 comment_like」的 N+1：
     * 一页 20 条评论 = 20 次查询，这里一次 IN 搞定。
     */
    private Set<Long> loadLikedIds(Long currentUserId, List<Long> commentIds) {
        if (currentUserId == null || commentIds.isEmpty()) {
            return Collections.emptySet();
        }
        return commentLikeMapper.selectList(Wrappers.<CommentLikeEntity>lambdaQuery()
                        .eq(CommentLikeEntity::getUserId, currentUserId)
                        .in(CommentLikeEntity::getCommentId, new HashSet<>(commentIds)))
                .stream()
                .map(CommentLikeEntity::getCommentId)
                .collect(Collectors.toSet());
    }
}
