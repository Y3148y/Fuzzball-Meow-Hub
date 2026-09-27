package com.xiaoku.common.config;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.jsontype.impl.LaissezFaireSubTypeValidator;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * 专供 Redis 序列化使用的 ObjectMapper。
 *
 * <p><b>为什么不直接用 Spring Boot 容器里那个 ObjectMapper：</b>
 * 那一个服务于 HTTP 报文，全局开着 {@code WRITE_DATES_AS_TIMESTAMPS=false} 等配置，
 * 往 Redis 里塞类型信息（{@code activateDefaultTyping}）会影响它对普通接口的输出。
 * 两个用途对序列化要求不同，必须隔离。
 *
 * <p><b>为什么 Redis 的值要带类型信息：</b>
 * Spring Data Redis 的 JSON 序列化若不写类型，反序列化时只能得到
 * {@code LinkedHashMap}，强转回 {@code UserEntity} 必然 ClassCastException。
 * 打开 {@code activateDefaultTyping} 后，Redis 里存的是
 * {@code ["com.xiaoku.module.user.vo.UserVO", {...}]}，能准确还原类型。
 * <p>代价是 Redis 里的内容可读性变差、体积变大、且<b>必须确保写入的都是可信对象</b>
 * （反序列化会按 Redis 里的类名去实例化，这正是典型的反序列化漏洞入口）。
 * 本项目只往 Redis 写自己产生的对象，不接受外部输入反序列化。
 */
@Component
public class RedisObjectMapperProvider {

    private static final String DATE_TIME_PATTERN = "yyyy-MM-dd HH:mm:ss";

    private final ObjectMapper objectMapper;

    public RedisObjectMapperProvider() {
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern(DATE_TIME_PATTERN);

        this.objectMapper = new ObjectMapper();
        // 字段可见性：直接读字段而非 getter，避免 getter 里的额外计算被触发
        this.objectMapper.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);
        this.objectMapper.activateDefaultTyping(
                LaissezFaireSubTypeValidator.instance,
                ObjectMapper.DefaultTyping.NON_FINAL);
        this.objectMapper.registerModule(new JavaTimeModule()
                .addSerializer(LocalDateTime.class, new LocalDateTimeSerializer(formatter))
                .addDeserializer(LocalDateTime.class, new LocalDateTimeDeserializer(formatter)));
        this.objectMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        this.objectMapper.disable(SerializationFeature.FAIL_ON_EMPTY_BEANS);
    }

    public ObjectMapper getObjectMapper() {
        return objectMapper;
    }
}
