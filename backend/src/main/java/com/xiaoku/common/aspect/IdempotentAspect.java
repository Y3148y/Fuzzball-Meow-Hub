package com.xiaoku.common.aspect;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.xiaoku.common.annotation.Idempotent;
import com.xiaoku.common.constant.RedisKey;
import com.xiaoku.common.context.LoginUser;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.Result;
import com.xiaoku.common.support.IdempotencyStore;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 幂等切面。
 *
 * <p>顺序上排在限流<b>之后</b>（{@code @Order(2)}）是有意的：
 * 重复提交应该被限流先当掉一部分（真刷子），剩下的才走幂等回放。
 * 反过来的话限流器会给每次回放也计数，一个弱网用户重试 5 次就把自己限流了。
 */
@Slf4j
@Aspect
@Component
@Order(2)
@RequiredArgsConstructor
public class IdempotentAspect {

    /** 幂等 Token 请求头。对齐 Stripe / PayPal 的做法，前端一眼就懂是什么 */
    public static final String HEADER = "X-Idempotency-Key";

    /** Token 长度上限：它会进 Redis key，不设限等于允许往 key 里塞任意长度的串 */
    private static final int MAX_TOKEN_LENGTH = 128;

    private final IdempotencyStore store;
    private final ObjectMapper objectMapper;

    @Around("@annotation(idempotent)")
    public Object around(ProceedingJoinPoint pjp, Idempotent idempotent) throws Throwable {
        HttpServletRequest request = currentRequest();
        String token = request == null ? null : request.getHeader(HEADER);
        if (!StringUtils.hasText(token)) {
            // 没带 Token 就退化成普通请求：老客户端、curl、Postman 不受影响
            return pjp.proceed();
        }
        if (token.length() > MAX_TOKEN_LENGTH) {
            // 静默截断会让两个不同的 Token 撞成同一个 key，比直接报错危险得多
            throw new BizException(ErrorCodeEnum.REPEAT_SUBMIT, "幂等 Token 过长（上限 " + MAX_TOKEN_LENGTH + " 字符）");
        }

        String key = buildKey(request, token);
        if (!store.tryClaim(key, idempotent.seconds())) {
            return replay(key, pjp);
        }

        Object result;
        try {
            result = pjp.proceed();
        } catch (Throwable t) {
            // 抛异常 = 这次提交没成，占位必须还回去，否则用户改对了也提交不了
            store.release(key);
            throw t;
        }
        // 只缓存成功：业务失败（比如「不能评论自己的笔记」）是可修正的，
        // 缓存下来等于让用户永远拿同一个错，且占着 key 不放
        if (result instanceof Result<?> r && !r.isSuccess()) {
            store.release(key);
        } else {
            store.markDone(key, result, idempotent.seconds());
        }
        return result;
    }

    /**
     * 回放上一次的结果。
     */
    private Object replay(String key, ProceedingJoinPoint pjp) throws Exception {
        String cached = store.peek(key);
        if (!StringUtils.hasText(cached)) {
            // 占位刚好过期（TTL 到了），已经查不到属于哪一次执行了。
            // 放行会真执行一次，不放行会误拒，只能如实告知稍后再试。
            throw new BizException(ErrorCodeEnum.REPEAT_SUBMIT, "上一次提交状态已过期，请稍后重试");
        }
        if (IdempotencyStore.PENDING.equals(cached)) {
            throw new BizException(ErrorCodeEnum.REPEAT_SUBMIT, "上一次提交仍在处理中，请稍后重试");
        }
        Class<?> returnType = ((MethodSignature) pjp.getSignature()).getReturnType();
        log.info("幂等回放，不重复执行 key={} 返回类型={}", key, returnType.getSimpleName());
        // 必须反序列化成 Result 而不是 Map：Spring 用 CGLIB 类代理，
        // 生成的方法体里写死了 `return (Result) advice返回值`，
        // 回一个 Map 会在代理层直接抛 ClassCastException（走不到消息转换器）。
        // data 字段会还原成 LinkedHashMap，键序就是当初序列化的顺序，
        // 再序列化出去与首次响应逐字节一致——回放不需要 data 的精确类型。
        return objectMapper.readValue(cached, returnType);
    }

    /**
     * key 里必须带 userId 与接口路径，否则不同用户 / 不同接口的同名 Token 会互相顶掉。
     */
    private String buildKey(HttpServletRequest request, String token) {
        LoginUser loginUser = UserContextHolder.get();
        String userId = loginUser == null ? "anon" : String.valueOf(loginUser.getUserId());
        return RedisKey.IDEMPOTENT + userId + ":" + request.getRequestURI() + ":" + token;
    }

    private HttpServletRequest currentRequest() {
        var attrs = RequestContextHolder.getRequestAttributes();
        return attrs instanceof ServletRequestAttributes servlet ? servlet.getRequest() : null;
    }
}
