package com.xiaoku.common.constant;

/**
 * Redis Key 命名规范。
 *
 * <p>统一 {@code xk:业务:参数} 三段式，好处：
 * <ol>
 *     <li>能按前缀批量删除（{@code SCAN MATCH "xk:note:*"}）；</li>
 *     <li>能按业务统计键数量，定位是哪块业务把内存吃满了；</li>
 *     <li>key 冲突的概率极低——最关键的一条，按裸 id 拼 key
 *         （比如 {@code note:12345}）迟早会和别的业务撞车。</li>
 * </ol>
 */
public final class RedisKey {

    public static final String PREFIX = "xk:";

    private RedisKey() {
    }

    /** 用户信息缓存 xk:user:info:{userId} */
    public static final String USER_INFO = PREFIX + "user:info:";

    /** 笔记详情缓存 xk:note:detail:{noteId} */
    public static final String NOTE_DETAIL = PREFIX + "note:detail:";

    /** 首页推荐流 ZSet xk:feed:recommend */
    public static final String FEED_RECOMMEND = PREFIX + "feed:recommend";

    /** 关注流 ZSet xk:feed:follow:{userId} */
    public static final String FEED_FOLLOW = PREFIX + "feed:follow:";

    /** 点赞用户集合 ZSet xk:note:like:users:{noteId}，member=userId，当前权威「谁点过」 */
    public static final String NOTE_LIKE_USERS = PREFIX + "note:like:users:";

    /** 收藏用户集合 ZSet xk:note:collect:users:{noteId}，member=userId，当前权威「谁收藏过」 */
    public static final String NOTE_COLLECT_USERS = PREFIX + "note:collect:users:";

    /** 待落库的笔记 ID 集合（Set）xk:note:dirty，计数落库任务按它批量对账 */
    public static final String NOTE_DIRTY = PREFIX + "note:dirty";

    /** 布隆过滤器（笔记ID是否真实存在） xk:bloom:note:id */
    public static final String BLOOM_NOTE_ID = PREFIX + "bloom:note:id";

    /** 关注关系 xk:follow:{userId} -> Set(followId) */
    public static final String FOLLOW = PREFIX + "follow:";

    /** 粉丝关系 xk:fans:{userId} -> Set(userId) */
    public static final String FANS = PREFIX + "fans:";

    /** 限流 xk:rate:{key} */
    public static final String RATE_LIMIT = PREFIX + "rate:";

    /** 接口幂等 Token xk:idempotent:{token} */
    public static final String IDEMPOTENT = PREFIX + "idempotent:";
}
