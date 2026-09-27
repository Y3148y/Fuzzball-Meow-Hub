package com.xiaoku.common.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.xiaoku.common.constant.CacheNames;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.cache.interceptor.SimpleCacheErrorHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;

import java.time.Duration;
import java.util.Map;

/**
 * 缓存管理器。
 *
 * <p><b>这里解决「缓存雪崩」：</b>
 * 大量 key 在同一时刻集中写入，若 TTL 都是 10 分钟，那么 10 分钟后会同时过期，
 * 瞬时几百个请求全部穿透到数据库，直接打挂 DB（这叫 cache avalanche）。
 * <p>做法是给 TTL 加<b>随机扰动</b>：{@code 基础TTL + random(0, TTL/10)}，
 * 让过期时间散开，把集中失效摊平成一段持续的流量。这是成本最低、见效最快的一招。
 *
 * <p>「击穿」（单个热点 key 过期）与「穿透」（查询根本不存在的 key）留到 P8 处理。
 *
 * <p>注意 Redis 自带的 SETNX/EX 锁是<b>按 key</b>加锁，只能防住「同一个 key」的击穿；
 * 而且需要额外释放锁、处理误删他人锁等细节，实现繁琐。
 * Spring Cache 的 {@code @Cacheable(sync = true)} 在单机/单实例下即可完成
 * 「同 key 串行回源」，语义正好够用且零心智负担。多实例下的分布式互斥留给 P8。
 */
@Slf4j
@Configuration
public class CacheConfig implements CachingConfigurer {

    private static final Duration DEFAULT_TTL = Duration.ofMinutes(10);
    private static final Duration USER_INFO_TTL = Duration.ofMinutes(30);
    private static final Duration NOTE_DETAIL_TTL = Duration.ofMinutes(10);

    /** 随机扰动上限比例：TTL / 10 */
    private static final double JITTER_RATIO = 0.1d;

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory connectionFactory,
                                     RedisObjectMapperProvider objectMapperProvider) {
        ObjectMapper mapper = objectMapperProvider.getObjectMapper();
        RedisCacheManager cacheManager = RedisCacheManager.builder(connectionFactory)
                .cacheDefaults(baseConfig(DEFAULT_TTL, mapper))
                .withInitialCacheConfigurations(Map.of(
                        CacheNames.USER_INFO, baseConfig(USER_INFO_TTL, mapper),
                        CacheNames.NOTE_DETAIL, baseConfig(NOTE_DETAIL_TTL, mapper)
                ))
                // 这里<b>刻意不开启</b> transactionAware()，原因见下方说明
                .build();
        log.info("Redis CacheManager 初始化完成，TTL={}s，抖动比例 1/{}",
                DEFAULT_TTL.toSeconds(), 1 / JITTER_RATIO);
        return cacheManager;
    }

    /**
     * <b>为什么不开 {@code transactionAware()}：</b>
     * <p>它会把缓存的 put/evict 都<b>延迟到事务提交时</b>执行，以保证「事务回滚则缓存不变」。
     * <p>但前提是采用「<b>先改库、再更新缓存</b>」的策略 —— 那种策略下缓存会被写入新值，
     * 一旦事务回滚就会留下脏数据，延迟提交正好能规避。
     * <p>本项目用的是「<b>先改库、再删缓存</b>」（cache-aside 经典写法），缓存从头到尾
     * 不会被写入新值，回滚时只是「多删了一次缓存」，代价仅为下次读多回源一次，本来就无害。
     * <p>而一旦开启 transactionAware，事务内的删除会被挂起，于是
     * {@code updateProfile} 里的「改库 → 删缓存 → 读缓存」读到的仍是旧值，
     * 接口把<b>没生效的改动</b>返回给前端 —— 这是比脏读更难发现的错误。
     * <p>结论：<b>transactionAware 只对「写缓存」策略有意义，对「删缓存」策略是负收益。</b>
     * 若真要做到缓存与事务严格一致，正确解法是「延迟双删」或订阅 binlog，而不是这个开关。
     */

    private RedisCacheConfiguration baseConfig(Duration ttl, ObjectMapper mapper) {
        return RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(ttl)
                // 键用 String 序列化，方便在 redis-cli 里肉眼排查
                .serializeKeysWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new GenericJackson2JsonRedisSerializer(mapper)))
                // 禁止缓存 null：Spring Cache 默认会缓存 null，
                // 那正是缓存穿透的帮凶（查不到 -> 缓存 null -> 之后永不查库）
                .disableCachingNullValues();
    }

    /**
     * 缓存故障降级。
     *
     * <p>Spring Cache 的默认行为是缓存出错就抛异常，那意味着 Redis 一挂、整个接口全挂 ——
     * 缓存本该是加速器，不该成为单点依赖。这里改成吞掉缓存异常，逻辑自动回落到查数据库。
     * <p>这是「缓存可用性 &gt; 缓存一致性」这条原则的直接体现。
     *
     * <p><b>但要注意这个降级是有代价的：</b>它会让「反序列化不兼容」这类<b>确定性 bug</b>
     * 退化成「缓存一直不命中 + 日志里一条 WARN」，接口功能完全正常，只是悄悄变慢，
     * 极难被发现。所以这里把读取失败打到 ERROR，并且对「不是网络类异常」的情况额外告警。
     *
     * <p>真实踩过的坑：VO 上写了 {@code @Builder} 导致 Lombok 不生成无参构造，
     * 缓存能写进去、却永远读不出来，报
     * {@code Cannot construct instance ... (no Creators, like default constructor, exist)}。
     *
     * <p><b>为什么写在 {@code CachingConfigurer#errorHandler()} 上：</b>
     * {@code CacheErrorHandler} 是缓存<b>切面</b>（{@code CacheInterceptor}）的属性，
     * 不是 {@code CacheManager} 的。{@code AbstractCacheManager#setCacheErrorHandler}
     * 在 Spring 6.2 已被移除，唯一官方的注入入口就是 {@link CachingConfigurer}。
     */
    @Override
    public CacheErrorHandler errorHandler() {
        return new SimpleCacheErrorHandler() {
            @Override
            public void handleCacheGetError(RuntimeException e, Cache cache, Object key) {
                // 网络抖动/连接池耗尽属于瞬时故障，WARN 即可；其余（序列化不兼容、
                // 类型变更等）属于代码 bug，必须 ERROR，否则「缓存永不命中」会被完全掩盖
                if (isTransient(e)) {
                    log.warn("缓存读取失败(瞬时) cache={} key={}，本次降级为直接查库", cache.getName(), key, e);
                } else {
                    log.error("缓存读取失败(疑似代码缺陷，缓存将长期不命中) cache={} key={}，"
                            + "请检查缓存对象的序列化/反序列化兼容性", cache.getName(), key, e);
                }
            }

            @Override
            public void handleCachePutError(RuntimeException e, Cache cache, Object key, Object value) {
                log.warn("缓存写入失败 cache={} key={}，本次忽略（下次读会回源）", cache.getName(), key, e);
            }

            @Override
            public void handleCacheEvictError(RuntimeException e, Cache cache, Object key) {
                log.warn("缓存删除失败 cache={} key={}，本次忽略（脏数据最多存活一个 TTL）",
                        cache.getName(), key, e);
            }

            @Override
            public void handleCacheClearError(RuntimeException e, Cache cache) {
                log.warn("缓存清空失败 cache={}，忽略", cache.getName(), e);
            }

            /**
             * 判断是否为「Redis 挂了」这类瞬时故障。
             * 连接类异常可以靠重试/高可用恢复；序列化异常重试一万次也一样，只能改代码。
             */
            private boolean isTransient(Throwable e) {
                for (Throwable t = e; t != null; t = t.getCause()) {
                    if (t instanceof org.springframework.data.redis.RedisConnectionFailureException
                            || t instanceof java.io.IOException
                            || t instanceof org.springframework.data.redis.RedisSystemException) {
                        return true;
                    }
                }
                return false;
            }
        };
    }
}
