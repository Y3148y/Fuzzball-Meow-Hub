package com.xiaoku.module.follow.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 关注 / 粉丝列表里的用户行。
 *
 * <p>等于 {@link com.xiaoku.module.user.vo.UserVO} + {@code followed}。
 * <b>刻意不继承 UserVO</b>：followed 是「依赖当前浏览者」的视图态，
 * 而 UserVO 按 userId 缓存在 Redis 里——把它塞进缓存对象等于把一个人的状态
 * 泄露给所有看到 TA 的人，所以必须在外层组合，每次请求现算。
 *
 * <p>不直接复用 UserVO 的另一个原因：JSON 里多一个字段就是多一处契约，
 * 各列表接口说清楚「这一行是给谁看的」比悄悄继承清晰。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "关注/粉丝列表用户行")
public class FollowUserVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "用户ID")
    private Long id;

    @Schema(description = "用户名")
    private String username;

    @Schema(description = "昵称")
    private String nickname;

    @Schema(description = "头像URL")
    private String avatar;

    @Schema(description = "个人简介")
    private String bio;

    @Schema(description = "性别 0 未知 1 男 2 女")
    private Integer gender;

    @Schema(description = "关注数")
    private Integer followCount;

    @Schema(description = "粉丝数")
    private Integer fansCount;

    @Schema(description = "获赞总数")
    private Integer likeReceivedCount;

    @Schema(description = "注册时间")
    private LocalDateTime createTime;

    @Schema(description = "当前登录用户是否已关注 TA")
    private Boolean followed;
}