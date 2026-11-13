package com.xiaoku.module.note.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 沉浸流的一张卡片（P34）
 *
 * <p><b>为什么不复用 {@link NoteListItemVO}</b>：那个只有 {@code cover} 一个封面，
 * 而沉浸流的卡片要在**卡内轮播**多张图 —— 复用它就得多打一次详情请求，
 * 而沉浸流是「一直往下划」的形态，每划一屏多一次往返会直接变成卡顿。
 * 所以这里直接带全部图。
 *
 * <p>刻意<b>不带正文全文</b>：沉浸流的卡片是一张图 + 标题 + 几行文字，
 * 正文全文几百字会让每张卡片的高度不可控，破坏「一屏一张」的构图。
 * 要读全文得点进详情页 —— 这正是沉浸流该有的行为。
 *
 * <p>{@code contentBrief} 是服务端截断的摘要（省得前端再截一次，
 * 也省得传输整个正文）。
 */
@Data
@Builder
@Schema(description = "沉浸流卡片")
public class ImmerseCardVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "笔记ID（雪花，序列化成字符串）")
    private Long id;

    @Schema(description = "1图文 2视频")
    private Integer type;

    @Schema(description = "视频 URL，仅 type=2")
    private String videoUrl;

    /** 多码率档位（P48）；null = 单码率。自动播会用到，别再打一次详情 */
    @Schema(description = "清晰度档位；null = 单码率")
    private List<VideoQualityVO> videoQualities;

    /** 封面（视频卡 = 转码抽帧、图文卡 = 第一张图）。视频加载/自动播前的占位画 */
    @Schema(description = "封面图 URL")
    private String cover;

    /** 全部图片，按 note_image 的顺序。沉浸流卡片在卡内轮播用 */
    @Schema(description = "图片列表（按笔记内顺序）")
    private List<String> images;

    @Schema(description = "标题")
    private String title;

    @Schema(description = "正文摘要（服务端截断，非全文）")
    private String contentBrief;

    @Schema(description = "点赞数")
    private Integer likeCount;

    @Schema(description = "收藏数")
    private Integer collectCount;

    @Schema(description = "评论数")
    private Integer commentCount;

    /**
     * 我是否已点赞 / 已收藏（P53 卡上互动）。
     * <p>与详情页同一口径：Redis 权威（ZSCORE），key 缺失或 Redis 不可用时
     * 回退 DB 关系行 —— 「缓存丢了」绝不等于「没点过」。
     */
    @Schema(description = "我是否已点赞")
    private Boolean liked;

    @Schema(description = "我是否已收藏")
    private Boolean collected;

    @Schema(description = "作者 userId")
    private Long authorId;

    @Schema(description = "作者昵称")
    private String authorNickname;

    @Schema(description = "作者头像")
    private String authorAvatar;

    @Schema(description = "我是否已关注该作者")
    private Boolean authorFollowed;

    @Schema(description = "发布时间")
    private LocalDateTime createTime;
}