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

    /**
     * access token 剩余有效秒数，前端据此提前刷新。
     *
     * <p>类型是 {@code Integer} 而非 {@code Long}：这是时长不是 ID，
     * 不该被 JacksonConfig 的「Long 转字符串」规则波及。
     * 秒数用 int 足够（int 上限约 68 年），前端拿到也就能直接做减法比较。
     */
    @Schema(description = "access token 剩余有效秒数，前端据此提前刷新")
    private Integer expiresIn;

    @Schema(description = "登录用户信息")
    private UserVO userInfo;
}
