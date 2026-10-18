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
}
