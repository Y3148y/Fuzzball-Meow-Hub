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
 * 私信会话实体，对应 {@code message_session} 表
 *
 * <p>一行 = <b>一对人</b>的一个会话，方向无关：A 给 B 发消息与 B 给 A 发消息
 * 都落在同一行（这是 {@code user_low_id} / {@code user_high_id} 规范化存储的全部理由，
 * 见 {@code sql/schema.sql} 的文件头注释）。
 *
 * <p>未读数<b>冗余存在会话行上</b>而不是实时 COUNT：会话列表是全站最常被打开的页面，
 * 而实时聚合的代价与消息总量成正比。漂移方向是安全的 —— 只会多不会少
 * （读消息失败时不清零，下次进会话页会再减一次），不会出现「有未读却显示已读」。
 */
@Data
@TableName("message_session")
public class MessageSessionEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 会话双方中 ID 较小的一方 */
    private Long userLowId;

    /** 会话双方中 ID 较大的一方 */
    private Long userHighId;

    /** 最后一条消息摘要（列表直接展示，省一次 JOIN） */
    private String lastMessage;

    /** 最后一条消息时间（会话列表排序键） */
    private LocalDateTime lastTime;

    /** 较小 ID 一方的未读数（对方发给我的） */
    private Integer unreadLow;

    /** 较大 ID 一方的未读数 */
    private Integer unreadHigh;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    /**
     * 我在这个会话里的未读数
     *
     * <p>调用方必须先确认自己属于这个会话，否则会拿到对方的未读数。
     */
    public Integer unreadOf(Long userId) {
        if (userId == null) {
            return 0;
        }
        if (userId.equals(userLowId)) {
            return unreadLow == null ? 0 : unreadLow;
        }
        if (userId.equals(userHighId)) {
            return unreadHigh == null ? 0 : unreadHigh;
        }
        return 0;
    }

    /** 会话另一方 */
    public Long peerOf(Long userId) {
        if (userId == null) {
            return null;
        }
        if (userId.equals(userLowId)) {
            return userHighId;
        }
        if (userId.equals(userHighId)) {
            return userLowId;
        }
        return null;
    }
}