package com.xiaoku.module.user.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 对外返回的用户信息。
 *
 * <p><b>为什么不直接返回 UserEntity：</b>
 * <ol>
 *     <li>Entity 里有 password 字段，加 {@code @JsonIgnore} 属于「靠注解兜底」，
 *         下一个人加字段时容易忘；</li>
 *     <li>以后要加「是否已关注」这类<b>因人而异</b>的字段时，
 *         放进 VO 才不会污染实体。</li>
 * </ol>
 * 这条「Entity 不出 Service，Controller 只收 VO/DTO」是团队规约里最该写死的一条。
 *
 * <p><b>为什么必须显式写 {@code @NoArgsConstructor}：</b>
 * 本类会被序列化进 Redis 缓存，再反序列化回 {@code UserVO}。
 * Jackson 走反射构造对象，需要一个<b>无参构造</b>。
 * 而 Lombok 的规则是：类上一旦出现 {@code @Builder}，{@code @Data} 就<b>不再</b>生成构造器
 * （{@code @Builder} 自己只生成一个全参构造），于是这个类就<b>没有无参构造</b>了。
 * 后果是写入正常、读取抛
 * {@code Cannot construct instance ... (no Creators, like default constructor, exist)}。
 * 凡是「会被缓存 / 会被 MQ 传递 / 会被 Redis 序列化」的类，都要显式补上无参构造。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "用户信息")
public class UserVO implements Serializable {

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
}
