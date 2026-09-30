package com.xiaoku.module.search.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/**
 * 笔记变更事件，经 {@code xk_note_event} topic 分发。
 *
 * <p><b>为什么所有 ID 都用 String：</b>生产端 Kafka 的 {@code JsonSerializer}
 * 复用的是 Spring MVC 那个 ObjectMapper（见 {@code KafkaConfig#xkProducerFactory}），
 * 而它被 {@code JacksonConfig} 定制成<b>所有 Long/long 序列化成字符串</b>。
 * 既然反正会变成字符串，DTO 字段干脆直接声明成 String，省得消费端再依赖
 * 「字符串放松成 Long」的隐式转换。
 *
 * <p><b>createTime 用 epochMillis（long）而不是 LocalDateTime：</b>
 * ES 的 date 字段自己有一套格式解析（缺省 {@code strict_date_optional_time}），
 * 字符串时间戳很容易在毫秒/秒、时区之间翻车；传 epochMillis 后消费端直接
 * 塞进 {@code FieldType.Date, format=epoch_millis} 字段，零歧义。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NoteEventDTO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /** 事件动作：发布（入索引 / upsert 文档） */
    public static final String ACTION_PUBLISH = "PUBLISH";

    /** 事件动作：下架（删除文档） */
    public static final String ACTION_UNPUBLISH = "UNPUBLISH";

    /** 事件动作：删除笔记（删除文档，P11）——与 UNPUBLISH 同特效，语义上区分开 */
    public static final String ACTION_DELETE = "DELETE";

    /** 事件动作：{@link #ACTION_PUBLISH} / {@link #ACTION_UNPUBLISH} / {@link #ACTION_DELETE} */
    private String action;

    /** 笔记 ID，ES 文档的 _id */
    private String noteId;

    /** 笔记标题（搜索字段） */
    private String title;

    /** 笔记正文（搜索字段） */
    private String content;

    /** 笔记类型：1 图文 2 视频 */
    private Integer type;

    /** 事件携带的状态：PUBLISH 时为 1（正常），UNPUBLISH 时为 2（下架） */
    private Integer status;

    /** 作者 ID */
    private String userId;

    /** 发布时间，epochMillis */
    private Long createTime;
}