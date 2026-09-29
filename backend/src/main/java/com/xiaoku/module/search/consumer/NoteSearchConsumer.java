package com.xiaoku.module.search.consumer;

import com.xiaoku.module.search.doc.NoteSearchDoc;
import com.xiaoku.module.search.event.NoteEventDTO;
import com.xiaoku.module.search.repository.NoteSearchRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * 笔记索引消费者。
 *
 * <p><b>group = {@code xk-search}</b>：与其它消费组隔离，重放/重置只影响搜索索引、
 * 不干扰别的下游。group-id 在 {@code @KafkaListener} 上写死，不走
 * {@code spring.kafka.consumer.group-id} 全局值。
 *
 * <p><b>at-least-once + 幂等 = 无副作用重放：</b>消费端手动提交、失败重试，
 * 而 ES 的 upsert 以 {@code noteId} 为 {@code _id}，同一条事件重放 N 次
 * 结果都一样，不会重复建文档。这正是选 Kafka 而不是直连 ES 的底气：
 * 「失败了重发都没事」，配合 /api/search/reindex 做对账。
 *
 * <p>反序列化失败（事件格式升级导致的脏消息）时
 * {@code ErrorHandlingDeserializer} 会把 value 解成 null、不抛异常——
 * 这里直接记日志跳过，还轮不到 DLT。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NoteSearchConsumer {

    /** 1 正常发布（0 草稿 / 2 下架不索引） */
    private static final int STATUS_PUBLISHED = 1;

    private final NoteSearchRepository noteSearchRepository;

    @KafkaListener(topics = "${xiaoku.kafka.note-topic}", groupId = "xk-search")
    public void onNoteEvent(NoteEventDTO event) {
        if (event == null || event.getNoteId() == null || event.getNoteId().isBlank()) {
            log.warn("收到无法解析的笔记索引事件，已跳过（由 ErrorHandlingDeserializer 兜底）");
            return;
        }
        switch (event.getAction()) {
            case NoteEventDTO.ACTION_PUBLISH -> {
                noteSearchRepository.save(toDoc(event));
                log.info("索引已更新 noteId={} action=PUBLISH", event.getNoteId());
            }
            case NoteEventDTO.ACTION_UNPUBLISH -> {
                noteSearchRepository.deleteById(event.getNoteId());
                log.info("索引已删除 noteId={} action=UNPUBLISH", event.getNoteId());
            }
            default -> log.warn("未知事件动作 action={} noteId={}，已忽略", event.getAction(), event.getNoteId());
        }
    }

    private static NoteSearchDoc toDoc(NoteEventDTO event) {
        NoteSearchDoc doc = new NoteSearchDoc();
        doc.setId(event.getNoteId());
        doc.setTitle(event.getTitle());
        doc.setContent(event.getContent());
        doc.setType(event.getType());
        doc.setStatus(event.getStatus() == null ? STATUS_PUBLISHED : event.getStatus());
        doc.setUserId(event.getUserId());
        doc.setCreateTime(event.getCreateTime());
        return doc;
    }
}