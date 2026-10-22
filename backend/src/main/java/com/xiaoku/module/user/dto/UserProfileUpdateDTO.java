package com.xiaoku.module.user.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
@Schema(description = "修改个人资料请求")
public class UserProfileUpdateDTO {

    @Schema(description = "昵称", example = "小哭猫")
    @Size(max = 32, message = "昵称不能超过 32 个字符")
    private String nickname;

    @Schema(description = "个人简介", example = "记录生活里的小确幸")
    @Size(max = 255, message = "简介不能超过 255 个字符")
    private String bio;

    @Schema(description = "性别 0 未知 1 男 2 女", example = "0")
    @Min(value = 0, message = "性别取值非法")
    @Max(value = 2, message = "性别取值非法")
    private Integer gender;

    /**
     * 头像地址。
     *
     * <p>⚠️ 这里<b>刻意只加 {@code @Size} 而没有任何格式注解</b>：
     * 合法性判定（预设白名单 or 本站上传前缀）在
     * {@code AvatarPresets#validate} 里，因为白名单是一份服务端配置，
     * 用正则写在注解里等于把同一份名单复制成两处，改一处漏一处。
     *
     * <p>三种取值语义（区分清楚，因为「不传」与「清空」在
     * update-strategy: not_null 下是两件不同的事）：
     * <ul>
     *   <li>{@code null}（不传）= 保持原头像</li>
     *   <li>{@code ""}（空串）= 清空头像，回退到前端兜底</li>
     *   <li>合法地址 = 换成它</li>
     * </ul>
     */
    @Schema(description = "头像地址：预设 /avatars/01.png~08.png，或上传返回的 /static/uploads/... 路径；"
            + "不传=保持不变，空串=清空", example = "/avatars/03.png")
    @Size(max = 512, message = "头像地址过长")
    private String avatar;

    /**
     * 是否把账号设为私密（P44）。
     *
     * <p>0 = 公开，1 = 私密。**null = 不修改**（保持原值）。
     *
     * <p>⚠️ 语义与「不传」必须分清：前端每次保存资料都会带上这个字段，
     * 所以「关掉私密」要靠**传 0**，不能靠不传 ——
     * 而 {@code update-strategy: not_null} 只剔除 null，**0 会被照写** ✓
     */
    @Schema(description = "是否私密账号 0 公开 1 私密", example = "0")
    @Min(value = 0, message = "私密取值非法")
    @Max(value = 1, message = "私密取值非法")
    private Integer isPrivate;

    /**
     * 主页背景图地址（P39）。
     *
     * <p>与 {@link #avatar} 同样的「不传 / 空串 / 合法地址」三态语义，
     * 也同样<b>只加 {@code @Size}</b>：合法性判定在
     * {@code UploadedUrlPolicy#validate} 里（白名单是服务端配置，
     * 写成注解等于把同一份规则复制成两处）。
     *
     * <p>⚠️ 背景图<b>没有「预设」那一档</b>：只有本站上传的地址合法。
     */
    @Schema(description = "主页背景图地址：上传返回的 /static/uploads/... 路径；不传=保持不变，空串=清空",
            example = "/static/uploads/2026/10/19/abc.png")
    @Size(max = 512, message = "背景图地址过长")
    private String background;
}
