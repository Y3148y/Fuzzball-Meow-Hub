package com.xiaoku.module.user.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/**
 * 「@ 提及」候选用户
 *
 * <p><b>为什么不复用 {@code MentionVO}</b>：那个是详情页渲染正文里
 * {@code @某人} 时用的，只要 id + 昵称 + 用户名（见它的类注释）。
 * 选择器还要**头像**（列表一眼认出是谁），两者用途不同、字段不同，
 * 合成一个 VO 会让渲染侧多带一个它用不上的字段。
 *
 * <p><b>刻意不给的字段</b>：手机号、邮箱、bio、性别、粉丝数 ——
 * 选择器只需要「认出这个人并插入 {@code @用户名}」，其余字段对
 * 选择这个动作没有帮助，带出去只是扩大信息暴露面。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "「@ 提及」候选用户")
public class UserPickVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "用户ID")
    private Long id;

    @Schema(description = "昵称（页面上显示的）")
    private String nickname;

    @Schema(description = "用户名（@ 之后真正插入的就是它）")
    private String username;

    @Schema(description = "头像")
    private String avatar;
}