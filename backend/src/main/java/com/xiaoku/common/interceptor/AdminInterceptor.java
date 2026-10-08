package com.xiaoku.common.interceptor;

import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.module.user.entity.UserEntity;
import com.xiaoku.module.user.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 管理端鉴权分层：只拦 {@code /api/admin/**}，且必须在 {@link AuthInterceptor} 之后跑。
 *
 * <p><b>为什么不把 role 写进 JWT？</b>
 * token 里带 role 看起来更省事（少一次查库），但有个致命问题：
 * <b>撤权要等 token 过期才生效</b>。而「把某个运营降级」几乎总是出事后要立刻做的事 ——
 * 等 30 分钟后那段时间里他照样能删数据。token 一旦发出去就没法收回，
 * 这是 JWT 无状态设计的固有代价，只能在<b>需要即时生效的字段</b>上退回查库。
 * 管理端流量本来就低，这一次 selectById 的代价可以忽略。
 *
 * <p><b>为什么不做成注解（{@code @RequireAdmin}）？</b>
 * 注解要防「新接口忘了加」。而管理接口的路径前缀天然是一个**收拢的口子**：
 * 新建 admin controller 时路径一定以 /api/admin 开头，一漏就是整条前缀都漏，
 * 会被立刻发现。反过来用注解的话，漏加的接口就是**静默越权**，
 * 没有任何人会注意到。路径前缀是「默认全保护」，注解是「默认全保护、
 * 但要记得手动上锁」—— 前者才是这个场景要的。
 *
 * <p><b>为什么不合并进 AuthInterceptor？</b>
 * 合并会让「是不是管理员」这条判断散布到通用鉴权里，
 * 而登录用户是不是管理员与「他能不能访问这个 URL」是两件事。
 * 分成两个拦截器后，职责是清晰的：先证明你是谁，再证明你能不能进这扇门。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AdminInterceptor implements HandlerInterceptor {

    /** 管理端路径前缀。集中成一个常量，避免各处硬编码字符串写错一个字符 */
    public static final String ADMIN_PREFIX = "/api/admin/";

    private final UserMapper userMapper;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        Long userId = com.xiaoku.common.context.UserContextHolder.requireUserId();
        UserEntity user = userMapper.selectById(userId);

        // 用户不存在（被逻辑删除）与不是管理员，都返同一个码。
        // 刻意<b>不</b>区分：「这账号不存在」本身就是不该让调用方知道的信息 ——
        // 它能用来探测账号是否注册过。
        if (user == null || !Integer.valueOf(1).equals(user.getRole())) {
            log.warn("非管理员访问管理端 uri={} userId={} role={}",
                    request.getRequestURI(), userId, user == null ? null : user.getRole());
            throw new BizException(ErrorCodeEnum.FORBIDDEN_NOT_ADMIN);
        }
        return true;
    }
}