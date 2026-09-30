package com.xiaoku.module.search.doc;

import com.xiaoku.module.note.entity.NoteEntity;
import org.springframework.data.annotation.Id;
import org.springframework.data.elasticsearch.annotations.DateFormat;
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;

import lombok.Data;

import java.time.ZoneOffset;

/**
 * 笔记搜索索引文档。
 *
 * <p><b>刻意只存「检索字段」：</b>封面、计数、作者昵称/头像这些<b>展示</b>字段
 * 不冗余进索引，搜索命中后由 MySQL 按 id 现查（见 {@code SearchService}）。
 * 好处是作者改昵称、点赞数变化不会让搜索卡片过期——「DB 是权威，ES 只管检索」
 * 和全项目「计数一致性推迟」的口径一致。
 *
 * <p>中文分词：镜像自建加装 IK（deploy/es/Dockerfile）。索引用
 * {@code ik_max_word}（最大粒度切词，召回全），查询用 {@code ik_smart}
 * （粗粒度，命中友好）——标准用法。改 analyzer 记得重建索引
 * （POST /api/search/reindex），旧 mapping 不会自动升级。
 */
@Data
@Document(indexName = "xk_note", createIndex = true)
public class NoteSearchDoc {

    @Id
    @Field(type = FieldType.Keyword)
    private String id;

    /** 标题：检索时权重 2（multi_match fields 里 title^2） */
    @Field(type = FieldType.Text, analyzer = "ik_max_word", searchAnalyzer = "ik_smart")
    private String title;

    @Field(type = FieldType.Text, analyzer = "ik_max_word", searchAnalyzer = "ik_smart")
    private String content;

    @Field(type = FieldType.Integer)
    private Integer type;

    /** 1 正常（0 草稿 / 2 下架不索引，搜索过滤在此字段） */
    @Field(type = FieldType.Integer)
    private Integer status;

    @Field(type = FieldType.Keyword)
    private String userId;

    @Field(type = FieldType.Date, format = DateFormat.epoch_millis)
    private Long createTime;

    /**
     * 由笔记实体构造索引文档（全量 reindex 用）。
     *
     * <p>createTime 转 epochMillis 时显式用 {@code +08:00}（Asia/Shanghai 无夏令时，
     * 固定偏移），不依赖 JVM 默认时区，避免换机器跑出不同的毫秒值。
     */
    public static NoteSearchDoc from(NoteEntity note) {
        NoteSearchDoc doc = new NoteSearchDoc();
        doc.setId(String.valueOf(note.getId()));
        doc.setTitle(note.getTitle());
        doc.setContent(note.getContent());
        doc.setType(note.getType());
        doc.setStatus(note.getStatus());
        doc.setUserId(String.valueOf(note.getUserId()));
        doc.setCreateTime(note.getCreateTime() == null ? null
                : note.getCreateTime().toEpochSecond(ZoneOffset.ofHours(8)) * 1000);
        return doc;
    }
}