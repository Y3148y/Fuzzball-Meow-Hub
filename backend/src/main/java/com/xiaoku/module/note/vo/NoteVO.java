package com.xiaoku.module.note.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 笔记详情 VO。
 *
 * <p>刻意<b>不返回</b> {@code userId}：对外只暴露昵称头像，
 * 内部 ID 属于用户域，没有对外暴露的必要。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "笔记详情")
public class NoteVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "笔记ID")
    private Long id;

    @Schema(description = "类型 1图文 2视频")
    private Integer type;

    @Schema(description = "标题")
    private String title;

    @Schema(description = "正文")
    private String content;

    @Schema(description = "封面图URL")
    private String cover;

    @Schema(description = "视频URL")
    private String videoUrl;

    @Schema(description = "点赞数")
    private Integer likeCount;

    @Schema(description = "收藏数")
    private Integer collectCount;

    @Schema(description = "评论数")
    private Integer commentCount;

    @Schema(description = "当前登录用户是否已点赞，前端据此决定按钮初始态，省一次请求")
    private Boolean liked;

    @Schema(description = "作者昵称")
    private String authorNickname;

    @Schema(description = "作者头像")
    private String authorAvatar;

    @Schema(description = "图片URL列表，按 sort 升序")
    private List<String> images;

    @Schema(description = "发布时间")
    private LocalDateTime createTime;
}
