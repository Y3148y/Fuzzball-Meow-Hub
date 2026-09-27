package com.xiaoku.common.interceptor;

import com.xiaoku.common.config.JwtProperties;
import com.xiaoku.common.context.LoginUser;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.util.JwtUtil;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 鉴权拦截器：解析 JWT 并把登录用户放进 ThreadLocal。
 *
 * <p><b>为什么用 HandlerInterceptor 而不是 Filter？</b>
 * <table border="1">
 *   <tr><th></th><th>Filter</th><th>HandlerInterceptor</th></tr>
 *   <tr><td>作用时机</td><td>进入 DispatcherServlet 之前</td><td>进入 Controller 之前</td></tr>
 *   <tr><td>能否拿到 HandlerMethod</td><td>拿不到</td><td>能（可读方法上的注解）</td></tr>
 *   <tr><td>能否读到请求体</td><td>能（但读了就必须包装 request）</td><td>能</td></tr>
 *   <tr><td>异常能否被 @RestControllerAdvice 捕获</td><td>不能</td><td>能</td></tr>
 * </table>
 * 业务鉴权用 Interceptor 的好处：可以直接读方法上的 {@code @RequireLogin} 之类注解做
 * 方法级鉴权，而且抛出的异常能被统一异常处理器接住，响应格式保持一致。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AuthInterceptor implements HandlerInterceptor {

    /** 与 JwtUtil 内部的 TYPE_ACCESS 保持一致 */
    private static final String TYPE_ACCESS = "access";

    private final JwtUtil jwtUtil;
    private final JwtProperties jwtProperties;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // CORS 预检请求不带业务语义，也不能带 Authorization 头，直接放行
        if (HttpMethod.OPTIONS.matches(request.getMethod())) {
            return true;
        }

        // 到这里说明路径<b>不在</b> MvcConfig 的白名单里，也就是「默认全部需要登录」。
        // 拿不到 token 就直接拒绝，而不是放行后交给业务层判断 ——
        // 后者意味着新接口只要忘了调 requireUserId() 就会静默变成匿名可访问。
        // 「白名单」必须是收紧的口子，绝不能是放松的口子。
        String token = jwtUtil.resolveToken(request.getHeader(jwtProperties.getHeader()));
        if (!StringUtils.hasText(token)) {
            log.warn("请求 {} 未携带 token，拒绝访问", request.getRequestURI());
            throw new BizException(ErrorCodeEnum.UNAUTHORIZED);
        }

        // 验签失败 / 已过期 -> JwtUtil 内部统一抛 TOKEN_INVALID；
        // refresh token 冒用 access token -> 这里拦住。
        // 两种失败都不往下走，也<b>不设置 ThreadLocal</b>，保证业务层拿到的必然是已鉴权身份
        Claims claims = jwtUtil.parse(token);
        jwtUtil.requireType(claims, TYPE_ACCESS);

        LoginUser loginUser = LoginUser.builder()
                .userId(jwtUtil.getUserId(claims))
                .username(jwtUtil.getUsername(claims))
                .build();
        UserContextHolder.set(loginUser);
        log.debug("请求 {} 鉴权通过 userId={}", request.getRequestURI(), loginUser.getUserId());
        return true;
    }

    /**
     * 请求结束时清理 ThreadLocal。
     * <p>用 afterCompletion 而不是 postHandle：postHandle 只在 handler 正常返回时执行，
     * 而业务里抛异常是很常见的（这正是我们希望的情况），那种情况下 ThreadLocal 会残留。
     */
    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        UserContextHolder.remove();
    }
}
