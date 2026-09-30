package com.xiaoku.module.note.converter;

import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.note.vo.NoteVO;
import com.xiaoku.module.user.vo.UserVO;

import java.util.List;

/**
 * Entity -> VO 转换，理由同 {@code UserConverter}：
 * Entity 不依赖 VO 包，VO 也不依赖 Entity，依赖方向清晰。
 */
public final class NoteConverter {

    private NoteConverter() {
    }

    /**
     * 组装笔记详情
     * <p>
     * 作者参数类型用 {@link UserVO} 而不是 UserEntity：
     * 笔记域只关心「昵称和头像」这两个展示字段，
     * 用 VO 可以让用户域的缓存逻辑（UserQueryService）在上游就生效，
     * 顺带避免把 password 这类敏感字段带到笔记域里再靠注解兜底。
     *
     * @param note           笔记本体
     * @param author         作者信息，<b>可为 null</b>（用户注销后笔记仍在）
     * @param images         已按 sort 排好序的图片 URL
     * @param liked          当前登录用户是否已点赞
     * @param collected      当前登录用户是否已收藏
     * @param authorFollowed 当前登录用户是否已关注作者（视图态，不进缓存）
     */
    public static NoteVO toVO(NoteEntity note, UserVO author, List<String> images,
                              boolean liked, boolean collected, boolean authorFollowed) {
        if (note == null) {
            return null;
        }
        return NoteVO.builder()
                .id(note.getId())
                .type(note.getType())
                .title(note.getTitle())
                .content(note.getContent())
                .cover(note.getCover())
                .videoUrl(note.getVideoUrl())
                .status(note.getStatus())
                .likeCount(note.getLikeCount())
                .collectCount(note.getCollectCount())
                .commentCount(note.getCommentCount())
                .liked(liked)
                .collected(collected)
                .authorId(note.getUserId())
                .authorNickname(author == null ? "已注销用户" : author.getNickname())
                .authorAvatar(author == null ? null : author.getAvatar())
                .authorFollowed(authorFollowed)
                .images(images == null ? List.of() : images)
                .createTime(note.getCreateTime())
                .build();
    }

    /**
     * 组装笔记列表卡片（关注流 / 作者主页）。
     *
     * @param note           列表行
     * @param author         作者信息，可为 null（用户注销）
     * @param authorFollowed 当前登录用户是否已关注作者
     */
    public static NoteListItemVO toListItemVO(NoteEntity note, UserVO author, boolean authorFollowed) {
        if (note == null) {
            return null;
        }
        return NoteListItemVO.builder()
                .id(note.getId())
                .type(note.getType())
                .title(note.getTitle())
                .cover(note.getCover())
                .status(note.getStatus())
                .likeCount(note.getLikeCount())
                .collectCount(note.getCollectCount())
                .commentCount(note.getCommentCount())
                .createTime(note.getCreateTime())
                .authorId(note.getUserId())
                .authorNickname(author == null ? "已注销用户" : author.getNickname())
                .authorAvatar(author == null ? null : author.getAvatar())
                .authorFollowed(authorFollowed)
                .build();
    }
}