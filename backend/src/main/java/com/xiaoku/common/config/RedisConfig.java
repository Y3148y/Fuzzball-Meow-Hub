package com.xiaoku.common.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

/**
 * RedisTemplate 配置。
 *
 * <p>键用 {@link StringRedisSerializer}，值用带类型信息的 JSON。
 * ObjectMapper 的构造逻辑集中在 {@link RedisObjectMapperProvider}，
 * 与 {@link CacheConfig} 共用同一个实例，避免两处配置不一致导致反序列化失败。
 */
@Configuration
@RequiredArgsConstructor
public class RedisConfig {

    private final RedisObjectMapperProvider objectMapperProvider;

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);

        Jackson2JsonRedisSerializer<Object> valueSerializer =
                new Jackson2JsonRedisSerializer<>(objectMapperProvider.getObjectMapper(), Object.class);
        StringRedisSerializer stringSerializer = new StringRedisSerializer();

        // key 用 String：便于在 redis-cli 里肉眼排查
        template.setKeySerializer(stringSerializer);
        template.setHashKeySerializer(stringSerializer);
        template.setValueSerializer(valueSerializer);
        template.setHashValueSerializer(valueSerializer);
        template.afterPropertiesSet();
        return template;
    }
}
