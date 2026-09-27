package com.xiaoku.common.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "xiaoku.jwt")
public class JwtProperties {

    /**
     * 签名密钥。HS256 要求至少 32 字节（256 bit），不满足会在解析时抛 WeakKeyException。
     * <p><b>生产环境必须用环境变量注入。</b>密钥泄漏等于任何人都能伪造任意用户的 token。
     */
    private String secret;

    /** access token 有效期（分钟） */
    private long accessTokenTtlMinutes = 120;

    /** refresh token 有效期（天） */
    private long refreshTokenTtlDays = 30;

    /** 签发者，写入 iss claim，解析时校验，防止别的系统的 token 被拿来用 */
    private String issuer = "xiaoku";

    /** 存放 token 的请求头名称 */
    private String header = "Authorization";

    /**
     * token 前缀。注意末尾的空格不能丢。
     * <p>留空则表示前端直接传裸 token（本项目不强制 Bearer 前缀，减少联调摩擦）。
     */
    private String tokenPrefix = "Bearer ";
}
