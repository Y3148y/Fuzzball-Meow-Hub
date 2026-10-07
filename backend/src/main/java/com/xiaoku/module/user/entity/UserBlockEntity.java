package com.xiaoku.module.user.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/** 黑名单关系，对应 user_block 表 */
@Data
@TableName("user_block")
public class UserBlockEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 拉黑的人 */
    private Long userId;

    /** 被拉黑的人 */
    private Long blockedId;

    private LocalDateTime createTime;
}