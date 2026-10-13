package com.xiaoku.module.message.entity;

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
 * 私信消息实体，对应 {@code message} 表
 *
 * <p>刻意<b>不存</b> {@code updateTime}：消息是<b>不可变</b>的事实 ——
 * 「编辑已发送的消息」和「撤回」是两种产品能力，都需要额外的状态机
 * （撤回要记谁撤的、编辑要保留历史），P22 刻意都不做。
 * 没有这一列也顺带省掉了「已读时间」与「编辑时间」的分歧。
 *
 * <p>{@code senderId} 与 {@code receiverId} <b>都冗余存在</b>，而不是只靠 session_id
 * 反推：未读角标要按接收者做索引查询（{@code idx_receiver_unread}），
 * 而「当前用户是否是这个会话的一方」也要一条 SQL 判完，省一次回表。
 */
@Data
@TableName("message")
public class MessageEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 所属会话 */
    private Long sessionId;

    private Long senderId;

    private Long receiverId;

    /** 消息正文（VARCHAR(1000)，与评论同量级） */
    private String content;

    /**
     * 消息类型：1 文本 2 图片
     *
     * <p>P32 加的。刻意<b>不引入第三种「图文混排」</b>：小红书私信发图就是纯图片，
     * 想带文字就在图片下面跟一条消息。把两者塞进同一条记录会让「会话列表的摘要」
     * 要在正文与图片之间二选一，而那两种选择都不是好的产品行为。
     *
     * <p>默认 1 而不是 NOT NULL 无默认：{@code non_null} 序列化策略下，
     * 字段缺失时前端拿到 {@code undefined}，老数据直接落到 {@code null} 分支。
     */
    private Integer type;

    /**
     * 图片 URL（仅 type=2 时有值）
     *
     * <p>刻意存<b>单个 URL</b> 而不是逗号分隔的多图：私信发图一次一张
     * （要发多张就发多条消息），这样「渲染时要按逗号拆」这个分支根本不存在，
     * 也就不会有「用户发了带逗号的 URL」这类边角。
     */
    private String imageUrl;

    /** 0未读 1已读 */
    private Integer isRead;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}