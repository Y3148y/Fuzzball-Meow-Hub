package com.xiaoku.module.follow.entity;

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
 * 关注关系实体，对应 user_follow 表。
 *
 * <p>表设计里 {@code status} 是「1已关注 2已取关（保留行以便恢复）」的软状态列，
 * 但 P6 决定的语义是<b>物理删</b>：关注 = insert（撞 uk_user_follow → 40001），
 * 取关 = delete（删 0 行 → 40002）。这与 P5 点赞/收藏的模式一致，
 * 让 40001 / 40002 两个错误码都真实可用。因此这里 status 恒为 1，不再维护取关行；
 * schema 的软状态意图让位给「错误码可测、模式统一」，取舍写在 README 的 P6 复盘里。
 */
@Data
@TableName("user_follow")
public class UserFollowEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 发起关注的用户ID */
    private Long userId;

    /** 被关注的用户ID */
    private Long followId;

    /** 1 已关注（物理删模式下恒为 1） */
    private Integer status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}