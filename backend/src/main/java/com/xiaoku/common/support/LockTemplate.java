package com.xiaoku.common.support;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * 分布式锁的薄封装：tryLock + Redis 不可用时的 fail-open。
 *
 * <p>用法：
 * <pre>
 *   try (var held = lockTemplate.tryLock("xiaoku:lock:xxx", Duration.ZERO, Duration.ofSeconds(30))) {
 *       if (held == null) {
 *           throw new BizException(...);   // 别人正持有，让路或报错由调用方决定
 *       }
 *       ... 临界区 ...
 *   }
 * </pre>
 *
 * <p>返回语义：
 * <ul>
 *   <li>拿到锁 → 返回一个必须 close 的 {@link LockHandle}（close 里按线程校验再解锁）</li>
 *   <li>等待超时仍未拿到 → 返回 {@code null}</li>
 *   <li>Redisson 本身连不上 → 返回一个空 handle（fail-open）：锁是为将来的
 *       多点部署准备的过渡手段，Redis 抖了不能把唯一实例的业务一起拖死；
 *       代价是极端情况下可能出现并发临界区，可接受</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LockTemplate {

    private final RedissonClient redissonClient;

    /**
     * @param wait 拿锁等待时长；{@link Duration#ZERO} 表示非阻塞，拿不到立刻放行
     * @param lease 锁的持有上限；超时自动释放，防持有方崩溃后死锁
     */
    public LockHandle tryLock(String key, Duration wait, Duration lease) {
        RLock lock = redissonClient.getLock(key);
        try {
            boolean acquired = lock.tryLock(wait.toMillis(), lease.toMillis(), TimeUnit.MILLISECONDS);
            if (!acquired) {
                return null;
            }
            return new LockHandle(lock);
        } catch (Exception e) {
            log.warn("获取分布式锁失败 key={}（Redis 不可用？），本次 fail-open 不阻塞业务", key, e);
            return new LockHandle(null);
        }
    }

    /** 持有中的锁句柄。close 时若仍被当前线程持有才释放（防止覆盖别人的锁）。 */
    @RequiredArgsConstructor
    public static final class LockHandle implements AutoCloseable {

        private final RLock lock;

        @Override
        public void close() {
            if (lock != null && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}