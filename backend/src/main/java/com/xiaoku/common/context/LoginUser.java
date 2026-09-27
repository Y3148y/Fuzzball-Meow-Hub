package com.xiaoku.common.context;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/**
 * 当前登录用户，由 AuthInterceptor 从 JWT 中解析出来放进 ThreadLocal。
 *
 * <p>刻意<b>只存轻量字段</b>（id + username），不存 nickname / avatar / 计数：
 * <ol>
 *     <li>ThreadLocal 里的对象跟着请求线程存活，字段越多越占内存；</li>
 *     <li>用户改了昵称后，本次请求内仍读到旧值会造成「改了没生效」的困惑。
 *         需要最新数据时按 id 走缓存查一次（见 UserService#getUserVO）。</li>
 * </ol>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LoginUser implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    private Long userId;

    private String username;
}
