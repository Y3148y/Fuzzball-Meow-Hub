package com.xiaoku.common.config;

import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;

@Configuration
public class RedissonConfig {

    @Bean(destroyMethod = "shutdown")
    public RedissonClient redissonClient(
            @Value("${spring.data.redis.host:127.0.0.1}") String host,
            @Value("${spring.data.redis.port:6379}") int port,
            @Value("${spring.data.redis.password:}") String password,
            @Value("${spring.data.redis.database:0}") int database) {

        Config config = new Config();
        // useSingleServer 而不是 useClusterServer：本项目只跑单机 Redis，
        // 但代码里所有加锁写法（RLock）换成集群只需改这一处配置，业务代码零改动。
        var singleServer = config.useSingleServer()
                .setAddress("redis://" + host + ":" + port)
                .setDatabase(database)
                .setConnectionMinimumIdleSize(5)
                .setConnectionPoolSize(24)
                // 发送失败重试时间与次数：网络抖动时先重试而不是直接抛异常
                .setRetryAttempts(3)
                .setRetryInterval(1000);
        if (StringUtils.hasText(password)) {
            singleServer.setPassword(password);
        }

        return Redisson.create(config);
    }
}
