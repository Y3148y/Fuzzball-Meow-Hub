package com.xiaoku.common.util;

import com.xiaoku.common.config.JwtProperties;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * JWT 签发与解析。
 *
 * <p><b>为什么用 JWT 而不是 Session：</b>
 * <ul>
 *     <li>Session 需要服务端存储，水平扩容要做 Session 共享（Redis 或 sticky session）；</li>
 *     <li>JWT 自带信息，服务端无状态，多实例天然可扩展；</li>
 *     <li>代价是<b>无法即时吊销</b>。所以本项目 access token 短有效期（2h）+
 *         refresh token 长有效期（30d），退出登录时把 refresh token 从 Redis 黑名单里删掉。</li>
 * </ul>
 *
 * <p><b>jjwt 0.12 的 API 与 0.9 完全不同</b>，网上老代码基本不能直接抄：
 * <pre>
 *   0.9  build:   Jwts.builder().setSubject().setExpiration().signWith(SignatureAlgorithm.HS256, secret)
 *        parse:   jwtParser.parseClaimsJws(token).getBody()
 *   0.12 build:   Jwts.builder().subject().expiration().signWith(key, Jwts.SIG.HS256)
 *        parse:   Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload()
 * </pre>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtUtil {

    private static final String CLAIM_USERNAME = "username";
    private static final String CLAIM_TYPE = "typ";
    private static final String TYPE_ACCESS = "access";
    private static final String TYPE_REFRESH = "refresh";
    private static final String CLAIM_JTI = "jti";

    private final JwtProperties jwtProperties;

    private SecretKey secretKey;

    @PostConstruct
    public void init() {
        if (!StringUtils.hasText(jwtProperties.getSecret())) {
            throw new IllegalStateException("xiaoku.jwt.secret 未配置，无法启动");
        }
        byte[] keyBytes = jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            // HS256 要求 256 bit 密钥。与其运行期抛 WeakKeyException，不如启动就失败
            throw new IllegalStateException(
                    "xiaoku.jwt.secret 至少需要 32 字节（当前 " + keyBytes.length + " 字节），"
                            + "HS256 要求 256bit 密钥");
        }
        this.secretKey = Keys.hmacShaKeyFor(keyBytes);
        log.info("JWT 初始化完成 issuer={} accessTtl={}min refreshTtl={}d",
                jwtProperties.getIssuer(),
                jwtProperties.getAccessTokenTtlMinutes(),
                jwtProperties.getRefreshTokenTtlDays());
    }

    /**
     * 签发 access token。
     *
     * @param userId   放在 sub，作为业务主键
     * @param username 放自定义 claim，前端展示用；<b>不要放敏感信息</b>，
     *                 JWT payload 只是 Base64 编码，不是加密，任何人都能解开看
     */
    public String createAccessToken(Long userId, String username) {
        return createToken(userId, username, TYPE_ACCESS,
                Duration.ofMinutes(jwtProperties.getAccessTokenTtlMinutes()));
    }

    /**
     * 签发 refresh token。
     * <p>刻意<b>不往 payload 里塞 username</b>：refresh token 生命周期长，
     * 用户改了昵称之后老 token 里的信息就过期了，用它换 access token 时
     * 应当以服务端当前数据为准。
     */
    public String createRefreshToken(Long userId) {
        return createToken(userId, null, TYPE_REFRESH,
                Duration.ofDays(jwtProperties.getRefreshTokenTtlDays()));
    }

    private String createToken(Long userId, String username, String type, Duration ttl) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .issuer(jwtProperties.getIssuer())
                .id(UUID.randomUUID().toString())
                .claim(CLAIM_TYPE, type)
                .claim(CLAIM_USERNAME, username)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(secretKey, Jwts.SIG.HS256)
                .compact();
    }

    /**
     * 解析并验签。任何失败都统一抛「凭证无效」，
     * 不把「签名不对」「已过期」「格式错误」区分开返回——那等于给攻击者提供 oracle。
     */
    public Claims parse(String token) {
        try {
            return Jwts.parser()
                    .verifyWith(secretKey)
                    .requireIssuer(jwtProperties.getIssuer())
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            log.warn("JWT 解析失败：{}", e.getMessage());
            throw new BizException(ErrorCodeEnum.TOKEN_INVALID);
        }
    }

    /**
     * 从 token 中取 userId。
     */
    public Long getUserId(Claims claims) {
        try {
            return Long.valueOf(claims.getSubject());
        } catch (NumberFormatException e) {
            throw new BizException(ErrorCodeEnum.TOKEN_INVALID);
        }
    }

    public String getUsername(Claims claims) {
        return claims.get(CLAIM_USERNAME, String.class);
    }

    public String getType(Claims claims) {
        return claims.get(CLAIM_TYPE, String.class);
    }

    /**
     * 校验 token 类型，防止拿 refresh token 直接当 access token 用（权限放大）。
     */
    public void requireType(Claims claims, String expectedType) {
        if (!expectedType.equals(getType(claims))) {
            throw new BizException(ErrorCodeEnum.TOKEN_INVALID);
        }
    }

    /**
     * 从请求头原始值里剥掉 "Bearer " 前缀。
     */
    public String resolveToken(String rawHeader) {
        if (!StringUtils.hasText(rawHeader)) {
            return null;
        }
        String prefix = jwtProperties.getTokenPrefix();
        if (StringUtils.hasText(prefix) && rawHeader.startsWith(prefix)) {
            return rawHeader.substring(prefix.length()).trim();
        }
        // 允许不写前缀直接传裸 token，联调更省事
        return rawHeader.trim();
    }

    @Getter
    public static class TokenPair {
        private final String accessToken;
        private final String refreshToken;

        public TokenPair(String accessToken, String refreshToken) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
        }
    }
}
