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
 * <p>字段里带 {@code authorId} 是 <b>P6 的刻意反转</b>：P3 曾坚持不暴露 userId
 * （内部 ID 属于用户域），但 P6 要支持「详情页直接关注作者」，前端必须能拿到
 * 作者的可寻址 ID 才能发 PUT /api/follow/{id}——不暴露就得为详情页单独加一个
 * 「查作者身份」的往返接口，得不偿失。
 *
 * <p>{@code authorFollowed} 是「依赖当前浏览者」的视图态，
 * 按请求现算，绝不进按 userId 缓存的 {@code UserVO}（见 NoteQueryServiceImpl）。
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

    @Schema(description = "当前登录用户是否已收藏")
    private Boolean collected;

    @Schema(description = "作者ID（P6 起暴露，用以支持详情页直接关注）")
    private Long authorId;

    @Schema(description = "作者昵称")
    private String authorNickname;

    @Schema(description = "作者头像")
    private String authorAvatar;

    @Schema(description = "当前登录用户是否已关注作者")
    private Boolean authorFollowed;

    @Schema(description = "图片URL列表，按 sort 升序")
    private List<String> images;

    @Schema(description = "发布时间")
    private LocalDateTime createTime;
}
