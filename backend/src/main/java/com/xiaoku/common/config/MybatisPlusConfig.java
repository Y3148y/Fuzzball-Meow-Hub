package com.xiaoku.common.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.BlockAttackInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.xiaoku.common.util.SnowflakeIdGenerator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MybatisPlusConfig {

    /**
     * 插件注册顺序有讲究（面试常问）：
     * 多租户 → 动态表名 → 分页 → 乐观锁 → 防全表更新
     * 分页插件必须放在最后，因为它要生成 count SQL 并做 SQL 改写，
     * 若放在它之后的插件会拿不到改写后的语句。
     */
    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

        PaginationInnerInterceptor pagination = new PaginationInnerInterceptor(DbType.MYSQL);
        // 单页最大条数限制，防止前端传 last=99999 一次性拖库
        pagination.setMaxLimit(500L);
        // 溢出总页数后不回到首页
        pagination.setOverflow(false);
        interceptor.addInnerInterceptor(pagination);

        // 乐观锁：配合实体类上的 @Version
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());

        // 阻断没有 where 条件的 update / delete，防止手滑清表
        interceptor.addInnerInterceptor(new BlockAttackInnerInterceptor());

        return interceptor;
    }

    /**
     * 把自研的雪花算法注册成 MyBatis-Plus 的 ID 生成策略。
     *
     * <p>用 {@code ASSIGN_ID} 而非 {@code AUTO}：MP 自带的 DefaultIdentifierGenerator
     * 同样是雪花算法，但它写死了 workerId 固定从 MAC 取，多实例部署会撞号；
     * 自己实现才能让 workerId 走配置。
     */
    @Bean
    public com.baomidou.mybatisplus.core.incrementer.IdentifierGenerator identifierGenerator(
            SnowflakeIdGenerator snowflakeIdGenerator) {
        return new com.baomidou.mybatisplus.core.incrementer.IdentifierGenerator() {
            @Override
            public java.lang.Number nextId(Object entity) {
                return snowflakeIdGenerator.nextId();
            }
        };
    }
}
