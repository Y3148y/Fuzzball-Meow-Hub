package com.xiaoku.common.interceptor;

import com.xiaoku.common.context.UserContextHolder;
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
 * 账号状态检查：被运营禁用的账号<b>立刻失去所有写能力</b>。
 *
 * <p><b>为什么登录那里已经拦了还不够？</b>
 * 因为 token 是无状态的、签发之后收不回来。运营禁用一个正在发内容的账号时，
 * 对方手上那个还没过期的 access token 照样能发 —— 从运营视角看就是
 * 「我明明禁了他，他怎么还在发」。要让禁用立刻生效，写路径上必须查一次库。
 * 这与 AdminInterceptor 不把 role 写进 JWT 是同一条理由。
 *
 * <p><b>为什么只拦写方法？</b>
 * <ul>
 *   <li>读要留给被禁用的人：他自己得能看到「我的账号出什么事了」，
 *       看不到的话只能去问客服。</li>
 *   <li>写是真正需要保护的部分，也是成本敏感的那一半 ——
 *       每次写多一次主键索引查找，而读（首页/详情/搜索）不增加任何开销。</li>
 * </ul>
 * 代价写在明面上：发布/点赞/评论每次多一条 SELECT。真要压下去得给账号状态加缓存，
 * 而缓存就意味着「禁用后有最多 N 秒的窗口」—— 那是与本类目的相反的取舍。
 *
 * <p>与 {@link AdminInterceptor} 同样按<b>默认全保护</b>组织：所有
 * POST/PUT/PATCH/DELETE 的 {@code /api/**} 都过一遍，白名单里那些
 * （登录注册等）在 AuthInterceptor 就被排除了，不会走到这里。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountStatusInterceptor implements HandlerInterceptor {

    private final UserMapper userMapper;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!isWrite(request.getMethod())) {
            return true;
        }
        Long userId = UserContextHolder.requireUserId();
        UserEntity user = userMapper.selectById(userId);
        // 用户不存在（被逻辑删除）走同一个码：被删号的人不该知道自己是「已删除」
        if (user == null || !Integer.valueOf(1).equals(user.getStatus())) {
            log.warn("已禁用账号尝试写操作 uri={} userId={}", request.getRequestURI(), userId);
            throw new BizException(ErrorCodeEnum.USER_BANNED);
        }
        return true;
    }

    private static boolean isWrite(String method) {
        return HttpMethodHolder.WRITE.contains(method);
    }

    /** 单独拎出来是为了让 isWrite 一行就能看清「到底哪几个算写」 */
    private static final class HttpMethodHolder {
        static final java.util.Set<String> WRITE = java.util.Set.of("POST", "PUT", "PATCH", "DELETE");
    }
}