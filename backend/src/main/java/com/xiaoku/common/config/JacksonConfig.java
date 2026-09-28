package com.xiaoku.common.config;

import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * <b>把 Long / long 一律序列化成 JSON 字符串。</b>
 *
 * <p><b>为什么必须这么做：</b>本项目主键用雪花算法生成，量级在 10^17：
 * <pre>362756654342606850</pre>
 * 而 JavaScript 的 {@code Number} 只能精确表示到
 * {@code Number.MAX_SAFE_INTEGER = 9007199254740991}（约 9.007×10^15）。
 * 超出之后 JSON.parse 会把 Long <b>静默四舍五入</b>：
 * <pre>JSON.parse('{"id":362756654342606850}').id  //  362756654342606848</pre>
 * 不报错、不告警，只是数<b>悄悄变了</b>。后果是：
 * <ul>
 *   <li>把 ID 原样回传给后端 → 查不到记录，表现为「数据明明发过却 404 / 笔记不存在」；</li>
 *   <li>两个不同 ID 解析成同一个 double → 误判相等或不等；</li>
 *   <li>页面上展示的 ID 和数据库里的对不上。</li>
 * </ul>
 * 这个坑是契约测试在 P3 抓出来的：发布后拿返回的 noteId 去查详情，
 * 服务端回了 20001「笔记不存在」，因为传回去的根本是另一个数。
 *
 * <p><b>为什么用 {@code Jackson2ObjectMapperBuilderCustomizer} 而不是直接改 Redis 的 ObjectMapper：</b>
 * {@code RedisObjectMapperProvider} 是<b>另一个</b> ObjectMapper 实例，且带
 * {@code activateDefaultTyping}。缓存里的对象落盘时若也变成字符串，
 * 反序列化回 UserVO 时 Long 字段会类型不匹配直接抛错。
 * 这里只定制 Spring MVC 用的那一个，缓存与 Kafka 的序列化保持原样。
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer longToStringCustomizer() {
        return builder -> {
            var module = new com.fasterxml.jackson.databind.module.SimpleModule("xiaoku-long-as-string");
            module.addSerializer(Long.class, ToStringSerializer.instance);
            module.addSerializer(Long.TYPE, ToStringSerializer.instance);
            builder.modulesToInstall(module);
        };
    }
}
