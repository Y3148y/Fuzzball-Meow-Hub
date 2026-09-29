package com.xiaoku.common.annotation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 接口限流。
 *
 * <p>标在 Controller 方法上，由 {@code RateLimitAspect} 统一拦截。
 * 阈值写在注解上而不是配置文件里，理由是**限流阈值属于业务语义**：
 * 「登录一分钟 10 次」和「搜索一分钟 60 次」是两个业务决定的取舍，
 * 放配置只会让人多绕一层文件去改一个本该和接口放在一起的东西。
 *
 * <p>刻意<b>不提供「默认阈值」</b>：没加注解的接口就是不限流，
 * 想限就显式写出来。默认给个宽松兜底值看着安全，实际上会让人误以为
 * 「框架已经帮我限了」，真出事时排查不到这里。
 *
 * @see com.xiaoku.common.aspect.RateLimitAspect
 */
@Documented
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimit {

    /** 窗口期内允许的请求数 */
    int count();

    /** 窗口长度（秒） */
    int seconds();

    /** 限流维度 */
    Dimension dimension() default Dimension.IP;

    /** 触发限流时返回给客户端的提示，为空则用错误码自带文案 */
    String message() default "";

    /**
     * 限流维度。
     */
    enum Dimension {

        /**
         * 按 IP。<b>登录、注册这类「还没有登录态」的接口只能用它</b> ——
         * 按用户限流对未登录请求没有意义（拿不到 userId）。
         */
        IP,

        /**
         * 按登录用户。登录后的接口用它更合理：同一个用户换 IP、换设备也共享一个额度，
         * 而 NAT 出口后的同机房用户不会被互相牵连。
         */
        USER,

        /**
         * IP 与登录用户<b>都</b>算进 key。用于「既要防单账号刷、也要防单 IP 扫」的场景，
         * 代价是同一个用户换 IP 就有了新额度，防单账号的效果弱于 {@link #USER}。
         */
        IP_AND_USER
    }
}
