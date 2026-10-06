package com.xiaoku.module.notification.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 通知列表项 VO
 *
 * <p>把「谁做了什么」拼成一句人话所需的全部信息：动作人（昵称/头像）+ 动作短语
 * + 所属笔记标题 + 时间。{@code targetId} 单独带出来是为了让前端能跳到
 * 评论所在位置（回复/赞评论时它是 commentId），前端按 {@code type} 决定跳哪。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "通知列表项")
public class NotificationVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "通知ID")
    private Long id;

    @Schema(description = "类型 1赞笔记 2评论 3赞评论 4关注 5回复")
    private Integer type;

    @Schema(description = "动作短语，如「赞了你的笔记」")
    private String typeText;

    @Schema(description = "触发者用户ID", example = "362756654342606850")
    private Long actorId;

    @Schema(description = "触发者昵称")
    private String actorNickname;

    @Schema(description = "触发者头像")
    private String actorAvatar;

    @Schema(description = "被作用的笔记ID或评论ID（按 type 决定跳哪里）")
    private Long targetId;

    @Schema(description = "所属笔记ID")
    private Long noteId;

    @Schema(description = "所属笔记标题（笔记被删时为 null）")
    private String noteTitle;

    @Schema(description = "评论/回复内容摘要")
    private String content;

    @Schema(description = "0未读 1已读")
    private Integer isRead;

    @Schema(description = "发生时间")
    private LocalDateTime createTime;
}