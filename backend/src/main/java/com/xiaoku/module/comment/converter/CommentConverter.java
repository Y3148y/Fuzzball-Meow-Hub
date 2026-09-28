package com.xiaoku.module.comment.converter;

import com.xiaoku.module.comment.entity.CommentEntity;
import com.xiaoku.module.comment.vo.CommentVO;
import com.xiaoku.module.user.vo.UserVO;

import java.util.List;

/**
 * Entity -> VO 转换，理由同 {@code NoteConverter}：
 * Entity 不依赖 VO 包，VO 也不依赖 Entity。
 */
public final class CommentConverter {

    private CommentConverter() {
    }

    /**
     * 把数据库里的哨兵值 {@code 0} 转成 {@code null}。
     *
     * <p>schema 里 parent_id / root_comment_id 是 {@code BIGINT NOT NULL DEFAULT 0}，
     * 用 0 表示"没有父级"。但对外暴露 0 是个陷阱：
     * <ol>
     *   <li>它和"ID 是 0"分不清，将来真有 id=0 的数据就说不清了；</li>
     *   <li>这两个字段是 {@code Long}，会被 JacksonConfig 序列化成字符串，
     *       于是"没有父级"变成 {@code "0"}，前端得写 {@code === '0'} 判断——
     *       而它<b>不能</b>用 {@code Number()} 转，因为非零时是 17 位雪花 ID，
     *       一转就丢精度。</li>
     * </ol>
     * 所以读出来就转成 null，前端 {@code if (!c.rootCommentId)} 即可，
     * 也和本 VO 里 {@code replyNickname} 等「没有就 null」的风格一致。
     */
    private static Long nullableId(Long id) {
        return id == null || id == 0L ? null : id;
    }

    /**
     * @param entity    评论本体
     * @param author    评论人，可为 null（用户注销）
     * @param replyTo   被回复者，可为 null
     * @param liked     当前用户是否已点赞
     * @param mine      是否当前用户自己发的
     * @param replies   子回复，可为 null
     * @param replyTotal 子回复总数，可为 null（子回复节点不填）
     */
    public static CommentVO toVO(CommentEntity entity, UserVO author, UserVO replyTo,
                                 boolean liked, boolean mine, List<CommentVO> replies,
                                 Integer replyTotal) {
        if (entity == null) {
            return null;
        }
        return CommentVO.builder()
                .id(entity.getId())
                .noteId(entity.getNoteId())
                .nickname(author == null ? "已注销用户" : author.getNickname())
                .avatar(author == null ? null : author.getAvatar())
                .content(entity.getContent())
                .likeCount(entity.getLikeCount() == null ? 0 : entity.getLikeCount())
                .parentId(nullableId(entity.getParentId()))
                .rootCommentId(nullableId(entity.getRootCommentId()))
                .replyNickname(replyTo == null ? null : replyTo.getNickname())
                .liked(liked)
                .mine(mine)
                .createTime(entity.getCreateTime())
                .replies(replies)
                .replyTotal(replyTotal)
                .build();
    }
}
