package com.xiaoku.module.search.repository;

import com.xiaoku.module.search.doc.NoteSearchDoc;
import org.springframework.data.elasticsearch.repository.ElasticsearchRepository;

/**
 * 笔记索引的读写口。
 *
 * <p>仓储只负责<b>单文档 upsert / 删除</b>（消费端用，_id=noteId 天然幂等）；
 * 查询不在仓储层做——搜索要 relevance 排序 + term 过滤，走
 * {@code ElasticsearchOperations} 的原生查询更直接。
 */
public interface NoteSearchRepository extends ElasticsearchRepository<NoteSearchDoc, String> {
}