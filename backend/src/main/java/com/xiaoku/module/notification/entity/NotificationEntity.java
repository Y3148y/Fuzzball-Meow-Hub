package com.xiaoku.module.notification.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 通知实体，对应 {@code notification} 表
 *
 * <p>一行 = 「{@code actorId} 对 {@code receiverId} 做了一件 {@code type} 的事」，
 * 作用对象是 {@code targetId}（笔记ID或评论ID），所属笔记冗余在 {@code noteId} 上，
 * 这样列表页不用为了展示「来自哪篇笔记」去做一次 JOIN。
 *
 * <p><b>为什么 {@code uk_notify_once} 是四列唯一</b>：同一个人可以反复赞同一篇笔记，
 * 但通知列表不该被同一个人刷屏 —— 所以只保留最早那一条，重复触发走
 * {@code UPDATE} 改时间（并把 {@code is_read} 重置为 0，用户应该重新看到）。
 * 这与点赞关系表 {@code note_like} 的处理不同：那里的唯一索引只是防重复计数，
 * 不影响业务可见的记录。
 */
@Data
@TableName("notification")
public class NotificationEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 收到通知的人 */
    private Long receiverId;

    /** 触发通知的人 */
    private Long actorId;

    /** 1赞笔记 2评论 3赞评论 4关注 5回复（枚举见 NotificationType） */
    private Integer type;

    /** 被作用的笔记ID或评论ID */
    private Long targetId;

    /** 所属笔记ID（冗余，免 JOIN） */
    private Long noteId;

    /** 评论/回复内容摘要，便于列表直接展示 */
    private String content;

    /** 0未读 1已读 */
    private Integer isRead;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}