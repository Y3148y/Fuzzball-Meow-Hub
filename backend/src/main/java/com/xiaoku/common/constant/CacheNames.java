package com.xiaoku.common.constant;

/**
 * Spring Cache 缓存名。
 *
 * <p>不同业务用不同 cacheName，才能给它们配不同 TTL：
 * 用户信息改动少、可以缓存 30 分钟；推荐流列表是 ZSet，不走这里。
 */
public final class CacheNames {

    /** 用户信息，TTL 30 分钟 */
    public static final String USER_INFO = "xk:cache:user:info";

    /** 笔记详情，TTL 10 分钟 */
    public static final String NOTE_DETAIL = "xk:cache:note:detail";

    private CacheNames() {
    }
}
