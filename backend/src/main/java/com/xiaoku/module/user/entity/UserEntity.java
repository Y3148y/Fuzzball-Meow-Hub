package com.xiaoku.module.user.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 用户实体，对应 user 表。
 *
 * <p>字段名用驼峰，靠 MyBatis-Plus 的 {@code map-underscore-to-camel-case} 映射到下划线列名。
 */
@Data
@TableName("user")
public class UserEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 主键由雪花算法生成，所以不用 {@code @TableId(type = IdType.AUTO)}。
     * INSERT 时 MP 会自动填入 IdWorker 的值——不过本项目在 MybatisPlusConfig 里
     * 换成了自研的 SnowflakeIdGenerator，machineId 可配置。
     */
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private String username;

    /**
     * BCrypt 散列后的口令，长度固定 60（含盐）。
     * <p>务必加 {@code @JsonIgnore}：只要实体被直接返回，密码就泄漏了。
     * 本项目在架构上就要求 Controller 一律返回 VO，从源头杜绝。
     */
    @JsonIgnore
    private String password;

    private String nickname;

    private String avatar;

    private String bio;

    /** 0 未知 1 男 2 女 */
    private Integer gender;

    /** 关注数，异步落库的冗余字段 */
    private Integer followCount;

    /** 粉丝数，异步落库的冗余字段 */
    private Integer fansCount;

    /** 获赞总数，异步落库的冗余字段 */
    private Integer likeReceivedCount;

    /** 0 禁用 1 正常 */
    private Integer status;

    private LocalDateTime lastLoginTime;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    @TableLogic
    private Integer deleted;
}
