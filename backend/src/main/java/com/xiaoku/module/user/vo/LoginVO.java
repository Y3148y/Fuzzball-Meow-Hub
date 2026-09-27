package com.xiaoku.module.user.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/**
 * 登录成功返回体。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "登录结果")
public class LoginVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "访问令牌，后续请求放请求头 Authorization")
    private String accessToken;

    @Schema(description = "刷新令牌，仅用于换新的 accessToken")
    private String refreshToken;

    @Schema(description = "access token 剩余有效秒数，前端据此提前刷新")
    private Long expiresIn;

    @Schema(description = "登录用户信息")
    private UserVO userInfo;
}
