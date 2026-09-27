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
}
