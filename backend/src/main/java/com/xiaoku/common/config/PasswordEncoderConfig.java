package com.xiaoku.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * 口令编码器。
 *
 * <p><b>为什么用 BCrypt 而不是 MD5/SHA256：</b>
 * <ul>
 *     <li>MD5/SHA 系列是<b>为速度设计</b>的摘要算法，可以每秒算几十亿次，
 *         拿到密文后暴力枚举彩虹表几乎无成本；</li>
 *     <li>BCrypt 是<b>为慢设计</b>的自适应哈希：结果里内嵌了「盐」和「代价因子」，
 *         相同口令每次结果都不同，且计算耗时可调（默认 10 轮）。
 *         攻击者每猜一个口令要付出 100ms，而服务端登录只需 100ms —— 成本差 1000 倍。</li>
 *     <li>BCrypt 还会把盐和代价因子一起编码进 60 字符的结果里，
 *         所以不需要单独建 salt 列，也不需要考虑「以后要提高代价因子」时怎么兼容旧数据
 *         （登录时用散列里的参数即可）。</li>
 * </ul>
 */
@Configuration
public class PasswordEncoderConfig {

    @Bean
    public BCryptPasswordEncoder passwordEncoder() {
        // 第二个参数是 strength（代价因子），默认 10。
        // 10 轮约 100ms；线上可按机器性能上调到 12，登录接口本身有频率限制兜底
        return new BCryptPasswordEncoder();
    }
}
