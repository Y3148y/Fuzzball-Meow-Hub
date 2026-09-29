package com.xiaoku.common.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 幂等占位与结果回放的存储。
 *
 * <p>三种状态编码在同一个 key 的 value 里：
 * <pre>
 *   不存在        → 从没来过（或 TTL 已过期）
 *   {@link #PENDING} → 上一次还在执行中
 *   一段 JSON      → 上一次已成功，value 就是当初发给客户端的响应
 * </pre>
 *
 * <p>用 value 区分状态而不是开两个 key：状态切换必须原子
 * （「删占位」和「写结果」之间如果宕机，就留下一个永久 PENDING，
 * 之后这个 key 的重试会被拒 10 分钟）。
 * 单 key + {@code SET} 覆盖写天然没有这个中间态。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IdempotencyStore {

    /** 执行中的哨兵值。用不可能出现在 JSON 里的字符串，解析时不会误判 */
    public static final String PENDING = "__PENDING__";

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    /**
     * 抢占这个 key。
     *
     * <p>{@code SET key PENDING NX EX ttl}：只有 key 不存在时才能写入，
     * 所以「已有占位」与「抢到占位」天然互斥，多实例并发下也只有一个赢家。
     */
    public boolean tryClaim(String key, int seconds) {
        try {
            Boolean ok = redisTemplate.opsForValue()
                    .setIfAbsent(key, PENDING, Duration.ofSeconds(seconds));
            return Boolean.TRUE.equals(ok);
        } catch (RuntimeException e) {
            // 幂等是保护措施，Redis 不可用时选择放行：宁可重复一次，
            // 也不要让整个发布/评论功能直接不可用。
            log.error("幂等占位失败，本次不做幂等放行 key={}", key, e);
            return true;
        }
    }

    /**
     * 读上一次的状态。
     *
     * @return null=没有记录；{@link #PENDING}=执行中；否则是响应 JSON
     */
    public String peek(String key) {
        try {
            return redisTemplate.opsForValue().get(key);
        } catch (RuntimeException e) {
            log.error("读取幂等记录失败，按无记录处理 key={}", key, e);
            return null;
        }
    }

    /** 标记成功并写入可回放的结果 */
    public void markDone(String key, Object response, int seconds) {
        try {
            redisTemplate.opsForValue()
                    .set(key, objectMapper.writeValueAsString(response), Duration.ofSeconds(seconds));
        } catch (Exception e) {
            // 结果没缓存住不影响本次请求的正确性（客户端已经拿到响应了），
            // 只是下次重试会重新执行一遍，属于可接受的降级
            log.error("回写幂等结果失败，后续重试将重新执行 key={}", key, e);
        }
    }

    /**
     * 释放占位。
     *
     * <p><b>失败路径必须调用</b>：否则一次「参数不合法」的请求就把这个 key 占住 10 分钟，
     * 用户改对了内容再提交却被告知「重复提交」，体验上比不做幂等更糟。
     */
    public void release(String key) {
        try {
            redisTemplate.delete(key);
        } catch (RuntimeException e) {
            log.warn("释放幂等占位失败 key={}", key, e);
        }
    }
}
