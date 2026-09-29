package com.xiaoku.common.aspect;

import com.xiaoku.common.annotation.RateLimit;
import com.xiaoku.common.constant.RedisKey;
import com.xiaoku.common.context.LoginUser;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.support.RateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 限流切面。
 *
 * <p>放在 Controller 方法<b>之前</b>执行（{@code @Order(1)}）是有讲究的：
 * 限流的目标是「挡住请求」，而不是「挡住已经进来的请求」。
 * 如果先做参数校验再限流，攻击者可以用一堆非法参数把校验线程占满，
 * 限流器形同虚设。
 *
 * <p>key 的三段式是 {@code xk:rate:{接口}:{维度值}}：
 * 接口维度让「登录」和「注册」各有各的额度（共用一个桶的话，
 * 疯狂注册会把正常登录也一起挡掉）；维度值按注解配置取 IP 或 userId。
 */
@Slf4j
@Aspect
@Component
@Order(1)
@RequiredArgsConstructor
public class RateLimitAspect {

    private final RateLimiter rateLimiter;

    /**
     * 是否信任 {@code X-Forwarded-For}。
     *
     * <p><b>默认 false 是刻意的：</b>这个头是<b>客户端可伪造</b>的。
     * 只有确定自己部署在会重写该头的网关之后（Nginx 的
     * {@code proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for} 也只是追加，
     * 需要显式覆盖），才应该打开它取真实来源 IP。
     * 打开后攻击者每次换一个伪造 IP 就能绕过限流。
     */
    @Value("${xiaoku.rate-limit.trust-forwarded-for:false}")
    private boolean trustForwardedFor;

    @Around("@annotation(rateLimit)")
    public Object around(ProceedingJoinPoint pjp, RateLimit rateLimit) throws Throwable {
        String key = buildKey(rateLimit);
        long current = rateLimiter.increment(key, rateLimit.seconds());
        if (current > rateLimit.count()) {
            String message = StringUtils.hasText(rateLimit.message())
                    ? rateLimit.message()
                    : ErrorCodeEnum.RATE_LIMITED.getMessage();
            log.warn("触发限流 key={} 当前窗口次数={} 阈值={}/{}s", key, current, rateLimit.count(), rateLimit.seconds());
            throw new BizException(ErrorCodeEnum.RATE_LIMITED, message);
        }
        return pjp.proceed();
    }

    private String buildKey(RateLimit rateLimit) {
        HttpServletRequest request = currentRequest();
        // 取不到请求上下文（比如被单元测试直接调用 Service）时退化成 "unknown"，
        // 此时所有调用共享一个桶——宁可限得严一点，也不要悄悄放行。
        String api = request == null ? "unknown" : request.getRequestURI();
        String subject = switch (rateLimit.dimension()) {
            case IP -> "ip:" + clientIp(request);
            case USER -> "user:" + currentUserId();
            case IP_AND_USER -> "both:" + clientIp(request) + ":" + currentUserId();
        };
        return RedisKey.RATE_LIMIT + api + ":" + subject;
    }

    private String currentUserId() {
        LoginUser loginUser = UserContextHolder.get();
        return loginUser == null ? "anon" : String.valueOf(loginUser.getUserId());
    }

    private HttpServletRequest currentRequest() {
        var attrs = RequestContextHolder.getRequestAttributes();
        return attrs instanceof ServletRequestAttributes servlet ? servlet.getRequest() : null;
    }

    /**
     * 取来源 IP。
     *
     * <p>{@code X-Forwarded-For} 的格式是 {@code 客户端IP, 代理1, 代理2}，
     * 最左边那个才是最初的来源，所以取第一个。
     */
    private String clientIp(HttpServletRequest request) {
        if (request == null) {
            return "unknown";
        }
        if (trustForwardedFor) {
            String forwarded = request.getHeader("X-Forwarded-For");
            if (StringUtils.hasText(forwarded)) {
                int comma = forwarded.indexOf(',');
                String first = comma > 0 ? forwarded.substring(0, comma) : forwarded;
                return first.trim();
            }
        }
        return request.getRemoteAddr();
    }
}
