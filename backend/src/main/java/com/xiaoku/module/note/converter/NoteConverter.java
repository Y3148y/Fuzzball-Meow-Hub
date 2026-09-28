package com.xiaoku.module.note.converter;

import com.xiaoku.module.note.entity.NoteEntity;
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
     * @param note      笔记本体，可为 null
     * @param author    作者信息，<b>可为 null</b>（用户注销后笔记仍在）
     * @param images    已按 sort 排好序的图片 URL
     * @param liked     当前登录用户是否已点赞
     * @param collected 当前登录用户是否已收藏
     */
    public static NoteVO toVO(NoteEntity note, UserVO author, List<String> images,
                              boolean liked, boolean collected) {
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
                .likeCount(note.getLikeCount())
                .collectCount(note.getCollectCount())
                .commentCount(note.getCommentCount())
                .liked(liked)
                .collected(collected)
                .authorNickname(author == null ? "已注销用户" : author.getNickname())
                .authorAvatar(author == null ? null : author.getAvatar())
                .images(images == null ? List.of() : images)
                .createTime(note.getCreateTime())
                .build();
    }
}
