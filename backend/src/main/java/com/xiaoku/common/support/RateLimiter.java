package com.xiaoku.common.support;

import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Set;

/**
 * 固定窗口限流器。
 *
 * <p><b>为什么必须用 Lua 而不是「INCR 再 EXPIRE」两条命令：</b>
 * 两条命令不是原子的。INCR 成功后、EXPIRE 执行前进程崩溃，这个 key 就
 * <b>永远不过期</b>——用户被永久限流，只能人工去 Redis 里删 key 才能恢复。
 * 更常见的是并发下的时序：两个请求同时 INCR 到阈值，其中一个在 EXPIRE 前失败。
 * 把两段塞进 Lua，Redis 单线程执行脚本期间不会被别的命令插队，天然原子。
 *
 * <p><b>为什么是「固定窗口」而不是滑动窗口：</b>
 * 固定窗口在窗口边界允许 2 倍突发（59 秒发 10 次 + 第 61 秒再发 10 次），
 * 这是它的固有缺陷。但滑动窗口要用 ZSet 记录每次请求的时间戳，
 * 请求量大时内存和 CPU 成本高得多。对「防暴力破解 / 防刷」这个目标，
 * 固定窗口足够；而它的好处是内存恒定、O(1)、实现只有 6 行。
 * 面试里说清楚这个取舍，比硬套一个复杂算法更值钱。
 */
@Slf4j
@Component
public class RateLimiter {

    /**
     * KEYS[1] = 限流 key
     * ARGV[1] = 窗口毫秒数
     * 返回值 = 当前窗口内已累计的请求数
     */
    private static final DefaultRedisScript<Long> SCRIPT;

    static {
        SCRIPT = new DefaultRedisScript<>("""
                local current = redis.call('INCR', KEYS[1])
                if current == 1 then
                    redis.call('PEXPIRE', KEYS[1], ARGV[1])
                end
                return current
                """, Long.class);
    }

    private final StringRedisTemplate redisTemplate;

    public RateLimiter(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * 记一次请求。
     *
     * @return 当前窗口内累计次数（含本次）
     */
    public long increment(String key, int seconds) {
        try {
            Long current = redisTemplate.execute(SCRIPT, Collections.singletonList(key),
                    String.valueOf(seconds * 1000L));
            return current == null ? 0L : current;
        } catch (RuntimeException e) {
            // 限流器本身是保护措施，不是业务功能：Redis 挂了不应该让整个接口不可用。
            // 这里选择「放行」并告警——宁可少一层保护，也不能因为缓存故障变成全站故障。
            // 反过来（fail-close）会把 Redis 的可用性变成所有接口的可用性上限。
            log.error("限流计数失败，本次放行（保护措施失效但业务不受影响）key={}", key, e);
            return 0L;
        }
    }

    /** 剩余可用次数，给「响应头里告诉客户端还剩多少」用 */
    public long remaining(String key, int count) {
        try {
            String raw = redisTemplate.opsForValue().get(key);
            if (raw == null) {
                return count;
            }
            return Math.max(0L, count - Long.parseLong(raw));
        } catch (RuntimeException e) {
            log.warn("读取限流计数失败 key={}", key, e);
            return count;
        }
    }

    /** 批量清掉某个前缀下的所有限流 key（改配置或测试隔离时用） */
    public long clearByPrefix(String prefix) {
        try {
            Set<String> keys = redisTemplate.keys(prefix + "*");
            if (keys == null || keys.isEmpty()) {
                return 0L;
            }
            Long deleted = redisTemplate.delete(keys);
            return deleted == null ? 0L : deleted;
        } catch (RuntimeException e) {
            log.warn("清理限流 key 失败 prefix={}", prefix, e);
            return 0L;
        }
    }
}
