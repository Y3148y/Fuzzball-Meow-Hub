package com.xiaoku.common.context;

import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;

/**
 * 登录上下文的 ThreadLocal 容器。
 *
 * <p><b>面试高频题：为什么一定要在 afterCompletion 里 remove？</b>
 * <p>Tomcat 的工作线程是<b>复用</b>的。请求 A 设置了 ThreadLocal，请求结束后不清理，
 * 线程被复用去处理请求 B 时就会读到请求 A 的用户身份 —— 这就是经典的
 * 「串号」越权漏洞，线上很难查，因为日志里看起来一切正常。
 * <p>所以：<b>谁设置谁清理，且必须在请求结束时清理（afterCompletion 而不是 postHandle，
 * 因为 postHandle 不会在 Controller 抛异常时执行）。</b>
 */
public final class UserContextHolder {

    private static final ThreadLocal<LoginUser> CONTEXT = new ThreadLocal<>();

    private UserContextHolder() {
    }

    public static void set(LoginUser loginUser) {
        CONTEXT.set(loginUser);
    }

    public static LoginUser get() {
        return CONTEXT.get();
    }

    public static void remove() {
        CONTEXT.remove();
    }

    /**
     * 取当前登录用户，未登录直接抛 401 语义的业务异常。
     * <p>放在这里而不是每个 Service 里各判一次，是为了避免重复代码，
     * 同时保证异常类型统一。
     */
    public static LoginUser requireLogin() {
        LoginUser loginUser = CONTEXT.get();
        if (loginUser == null) {
            throw new BizException(ErrorCodeEnum.UNAUTHORIZED);
        }
        return loginUser;
    }

    public static Long requireUserId() {
        return requireLogin().getUserId();
    }
}
