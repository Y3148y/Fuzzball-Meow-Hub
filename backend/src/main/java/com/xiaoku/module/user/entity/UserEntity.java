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

    /**
     * 主页背景图（P39）。
     *
     * <p>与 {@link #avatar} 一样是**用户可写的 URL 字段**，
     * 所以合法性由 {@code UploadedUrlPolicy} 把关，不是这里。
     */
    private String background;

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

    /**
     * 角色：0 普通用户 1 管理员（P20 运营后台）。
     *
     * <p>刻意<b>不写进 JWT</b>：写在 token 里撤权要等 token 过期才生效，
     * 而「把某个运营降级」往往正是出事后要立刻做的事。AdminInterceptor
     * 每次请求查库，代价可以接受（管理端流量本来就低）。
     */
    private Integer role;

    /**
     * 私密账号（P44 隐私设置）。
     *
     * <p>1 = 私密：这个账号的笔记**只有关注了 TA 的用户**能看（单向关注也算，
     * 作者本人当然能看）。0 = 公开（默认）。
     *
     * <p>⚠️ 这个字段是「整站可见性」的开关，**漏一处过滤就是私密内容泄露** ——
     * 所以要改的地方不止详情页：发现流 / 沉浸流 / 搜索 / 作者主页 / 评论列表
     * 每一处都得过滤（见 AGENTS P44）。
     */
    private Integer isPrivate;

    private LocalDateTime lastLoginTime;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    @TableLogic
    private Integer deleted;
}
