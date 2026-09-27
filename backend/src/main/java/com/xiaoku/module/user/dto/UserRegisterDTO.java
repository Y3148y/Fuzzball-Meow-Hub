package com.xiaoku.module.user.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 注册入参。
 *
 * <p>校验规则放在 DTO 上，用 {@code @Valid} 在 Controller 参数上触发。
 * <p><b>为什么不用 JSR-303 之外的校验：</b>把规则写在 DTO 上有三个好处——
 * 规则与字段强绑定（重构 IDE 能提示）、前端可读（Knife4j 直接展示）、
 * 错误信息自动汇集成 Result 返回。
 */
@Data
@Schema(description = "注册请求")
public class UserRegisterDTO {

    @Schema(description = "用户名，4~20 位字母/数字/下划线", example = "xiaoku_01", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "用户名不能为空")
    @Size(min = 4, max = 20, message = "用户名长度必须在 4~20 之间")
    @Pattern(regexp = "^[a-zA-Z0-9_]+$", message = "用户名只能包含字母、数字和下划线")
    private String username;

    @Schema(description = "密码，8~20 位", example = "Xk@123456", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "密码不能为空")
    @Size(min = 8, max = 20, message = "密码长度必须在 8~20 之间")
    private String password;

    @Schema(description = "昵称，不填则与用户名相同", example = "小哭猫")
    @Size(max = 32, message = "昵称不能超过 32 个字符")
    private String nickname;
}
