package com.xiaoku.module.note.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 笔记列表卡片 VO（关注流 / 作者主页复用）。
 *
 * <p>列表场景塞进全文没意义，只带标题、封面、计数和作者概要。
 * {@code authorFollowed} 是「依赖当前浏览者」的视图态，和详情 VO 一样
 * 每次请求现算，不进任何缓存。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "笔记列表项")
public class NoteListItemVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "笔记ID")
    private Long id;

    @Schema(description = "类型 1图文 2视频")
    private Integer type;

    @Schema(description = "标题")
    private String title;

    @Schema(description = "封面图URL")
    private String cover;

    @Schema(description = "点赞数")
    private Integer likeCount;

    @Schema(description = "收藏数")
    private Integer collectCount;

    @Schema(description = "评论数")
    private Integer commentCount;

    @Schema(description = "发布（下架）时间")
    private LocalDateTime createTime;

    @Schema(description = "作者ID", example = "362756654342606850")
    private Long authorId;

    @Schema(description = "作者昵称")
    private String authorNickname;

    @Schema(description = "作者头像")
    private String authorAvatar;

    @Schema(description = "当前登录用户是否已关注作者")
    private Boolean authorFollowed;
}