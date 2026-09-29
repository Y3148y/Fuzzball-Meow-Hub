package com.xiaoku.common.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.serializer.JsonSerializer;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class KafkaConfig {

    @Value("${xiaoku.kafka.note-topic:xk_note_event}")
    private String noteTopic;

    @Value("${xiaoku.kafka.partitions:3}")
    private int partitions;

    @Value("${xiaoku.kafka.replicas:1}")
    private short replicas;

    /**
     * 笔记事件主题。
     *
     * <p><b>分区数为什么是 3：</b> 消费端并发度上限就是分区数。设成 3 意味着
     * 「点赞落库」「ES 同步」这类消费者最多 3 个实例并行。分区太少限制吞吐，
     * 太多则会增加文件句柄、降低消费端 rebalance 速度。
     *
     * <p><b>为什么 topic 名带下划线不用点：</b> Kafka 的监控指标名是
     * {@code topic + "." + group + "." + metric}，如果 topic 本身带点，
     * 指标名会被解析成四段，很多监控平台直接丢数据。Kafka 官方的
     * log4j 配置也会对带点的 topic 打出 warning。
     */
    @Bean
    public NewTopic noteEventTopic() {
        Map<String, String> config = new HashMap<>(2);
        // 单节点环境副本因子只能是 1
        config.put("cleanup.policy", "delete");
        config.put("retention.ms", String.valueOf(7L * 24 * 3600 * 1000));
        return TopicBuilder.name(noteTopic)
                .partitions(partitions)
                .replicas(replicas)
                .configs(config)
                .build();
    }

    /**
     * Topic 由 Broker 自动创建时（如 KAFKA_AUTO_CREATE_TOPICS_ENABLE=true），
     * 分区数是 broker 默认值，无法保证一致。因此这里用 NewTopic Bean 显式声明，
     * 启动时 KafkaAdmin 会按这份定义创建或校验 Topic。
     */
    @Bean
    public KafkaTemplate<String, Object> kafkaTemplate(
            org.springframework.kafka.core.ProducerFactory<String, Object> producerFactory) {
        return new KafkaTemplate<>(producerFactory);
    }

    /**
     * 生产端 Factory。
     *
     * <p><b>为什么不能只丢一张手写 config 进去：</b>{@code bootstrap.servers}
     * 只存在于 Spring Boot 的 {@code KafkaProperties}（application.yml 的
     * {@code spring.kafka.*}）里。这里如果手拼 Map 而漏掉它，KafkaTemplate
     * 首次 send 时抛 {@code No resolvable bootstrap urls}——P0 铺 Kafka 时
     * 没有生产者一直没暴露，P7 首次真实发送就被打脸。
     * 所以先 {@code buildProducerProperties()} 打底（bootstrap.servers、
     * enable.idempotence、max.in.flight 等全来自 yml），再用显式键覆盖
     * 下面这几个有说明的项。
     */
    @Bean
    public org.springframework.kafka.core.ProducerFactory<String, Object> xkProducerFactory(
            ObjectMapper objectMapper,
            org.springframework.boot.autoconfigure.kafka.KafkaProperties kafkaProperties) {
        Map<String, Object> config = kafkaProperties.buildProducerProperties(null);
        // acks=-1 即 all，等待所有 ISR 副本确认后才认为写入成功
        config.put("acks", "all");
        // 默认 0 不重试。生产端至少给 3 次重试，覆盖 Broker 短暂 Leader 切换的场景
        config.put("retries", 3);
        config.put("batch.size", 16384);
        config.put("linger.ms", 10);
        // key 序列化决定分区归属：同一个 key 一定落到同一分区，
        // 这是「同一篇笔记的点赞事件串行处理、不并发改同一行计数」的前提
        config.put("key.serializer", org.apache.kafka.common.serialization.StringSerializer.class.getName());
        config.put("value.serializer", JsonSerializer.class.getName());
        config.put("spring.json.add.type.headers", false);

        org.springframework.kafka.core.DefaultKafkaProducerFactory<String, Object> factory =
                new org.springframework.kafka.core.DefaultKafkaProducerFactory<>(config);
        factory.setValueSerializer(new JsonSerializer<>(objectMapper));
        return factory;
    }

    /**
     * 消费端统一错误处理：固定退避重试 3 次（间隔 1s）仍失败 → 转发到
     * {@code <原topic>.DLT} 死信主题，且<b>不再让异常冒泡</b>（recovered 视为已消费、提交位移）。
     *
     * <p>依赖 {@code spring.kafka.consumer.value-deserializer=ErrorHandlingDeserializer}：
     * 反序列化失败的脏消息不会进到这里（value 直接被解成 null，
     * {@code NoteSearchConsumer} 收到空事件只记日志跳过），
     * 这里兜的是<b>业务处理失败</b>（如 ES 短暂不可用）。
     *
     * <p>死信消息可以手动回放：把 DLT 里的事件重投回主 topic，消费端幂等 upsert 不受影响。
     */
    @Bean
    public org.springframework.kafka.listener.CommonErrorHandler kafkaErrorHandler(
            KafkaTemplate<String, Object> kafkaTemplate) {
        org.springframework.kafka.listener.DeadLetterPublishingRecoverer recoverer =
                new org.springframework.kafka.listener.DeadLetterPublishingRecoverer(kafkaTemplate);
        return new org.springframework.kafka.listener.DefaultErrorHandler(recoverer,
                new org.springframework.util.backoff.FixedBackOff(1000L, 3));
    }
}
