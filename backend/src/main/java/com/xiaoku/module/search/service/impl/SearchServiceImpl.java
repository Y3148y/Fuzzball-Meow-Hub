package com.xiaoku.module.search.service.impl;

import co.elastic.clients.elasticsearch._types.FieldValue;
import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.support.LockTemplate;
import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.support.NoteCounterStore;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.search.doc.NoteSearchDoc;
import com.xiaoku.module.search.repository.NoteSearchRepository;
import com.xiaoku.module.search.service.SearchService;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.elasticsearch.client.elc.NativeQuery;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.SearchHits;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.time.Duration;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 搜索实现：ES 检索，MySQL 回填。
 *
 * <p><b>为什么搜完之后还要回 MySQL：</b>搜索结果要以 {@code NoteListItemVO}
 * 卡片的形态返回（作者昵称/头像、三个计数），而这些字段<b>不冗余进索引</b>
 * （见 {@code NoteSearchDoc} 注释）。ES 每页只给「命中的 id + 顺序 + 总数」，
 * 之后一条 {@code IN} 把笔记捞回、一条 {@code IN} 把作者捞回、一次批量判关注，
 * 总共三次 DB 往返就把整页卡片拼齐。
 *
 * <p><b>顺序保证：</b>{@code selectBatchIds} 返回顺序不保证，所以先用
 * id→实体 建 Map，再按 ES 命中顺序逐条取，「相关性排序」是搜索的命根子，
 * 不能因回表而丢。
 *
 * <p><b>ES 挂了怎么办：</b>{@code SEARCH_SERVICE_ERROR(50001)}——写接口不落
 * ES 不阻塞（发布照常成功，事件之后补），读接口在 ES 不可用时降级为明确报错
 * 而不是返回空结果假装「没有这篇」，把「搜索暂时不可用」和「搜不到」分开。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SearchServiceImpl implements SearchService {

    /** 1 正常发布，只有这个状态入索引 */
    private static final int STATUS_PUBLISHED = 1;

    private static final int REINDEX_BATCH_SIZE = 1000;

    /** 重建是「删旧索引 + 从库回灌」的重操作，两点并发会互相拆台，用锁串行化 */
    private static final String REINDEX_LOCK_KEY = "xiaoku:lock:search:reindex";

    private final ElasticsearchOperations operations;
    private final NoteSearchRepository noteSearchRepository;
    private final NoteMapper noteMapper;
    private final UserQueryService userQueryService;
    private final UserFollowQueryService userFollowQueryService;
    private final NoteCounterStore counterStore;
    private final LockTemplate lockTemplate;

    @Override
    public PageVO<NoteListItemVO> searchNote(String keyword, int page, int size) {
        Long currentUserId = UserContextHolder.requireUserId();
        if (keyword == null || keyword.isBlank()) {
            throw new BizException(ErrorCodeEnum.SEARCH_KEYWORD_EMPTY);
        }
        int safePage = Math.max(page, 1);
        int safeSize = (int) Math.min(Math.max(size, 1L), 100L);

        Query query = new Query.Builder()
                .bool(b -> b
                        .must(m -> m.multiMatch(mm -> mm
                                .query(keyword.trim())
                                .fields(List.of("title^2", "content"))))
                        .filter(f -> f.term(t -> t.field("status").value(FieldValue.of(1L)))))
                .build();

        // 相关性（_score）为主排序，同分值再按发布时间新→旧。
        // SortOptions.of(...) 各建一个排序列，再一并传给 withSort（两列按顺序生效）
        NativeQuery nativeQuery = NativeQuery.builder()
                .withQuery(query)
                .withSort(
                        co.elastic.clients.elasticsearch._types.SortOptions.of(
                                s -> s.score(sc -> sc.order(SortOrder.Desc))),
                        co.elastic.clients.elasticsearch._types.SortOptions.of(
                                s -> s.field(f -> f.field("createTime").order(SortOrder.Desc))))
                .withPageable(PageRequest.of(Math.max(safePage - 1, 0), safeSize))
                .build();

        SearchHits<NoteSearchDoc> hits;
        try {
            hits = operations.search(nativeQuery, NoteSearchDoc.class);
        } catch (RuntimeException e) {
            log.error("搜索失败 keyword={}", keyword, e);
            throw new BizException(ErrorCodeEnum.SEARCH_SERVICE_ERROR);
        }

        List<NoteListItemVO> list = hydrate(hits, currentUserId);
        return PageVO.of(list, hits.getTotalHits(), safePage, safeSize);
    }

    @Override
    public int rebuildNoteIndex() {
        // 非阻塞拿锁：有人在重建就让路，别两个请求同时 delete + 回灌。
        // Redis 不可用时 LockTemplate 会 fail-open（单机部署值得），
        // 所以 null 的唯一含义就是「确确实实被另一个重建占着」。
        try (LockTemplate.LockHandle held = lockTemplate.tryLock(
                REINDEX_LOCK_KEY, Duration.ZERO, Duration.ofSeconds(30))) {
            if (held == null) {
                throw new BizException(ErrorCodeEnum.SEARCH_SERVICE_ERROR, "已有重建任务在跑，请稍后再试");
            }
            return doRebuild();
        }
    }

    private int doRebuild() {
        var indexOps = operations.indexOps(NoteSearchDoc.class);
        if (indexOps.exists()) {
            indexOps.delete();
        }
        indexOps.createWithMapping();

        long total = noteMapper.selectCount(Wrappers.<NoteEntity>lambdaQuery()
                .eq(NoteEntity::getStatus, STATUS_PUBLISHED));
        int indexed = 0;
        for (long offset = 0; offset < total; offset += REINDEX_BATCH_SIZE) {
            List<NoteEntity> notes = noteMapper.selectList(Wrappers.<NoteEntity>lambdaQuery()
                    .eq(NoteEntity::getStatus, STATUS_PUBLISHED)
                    .orderByAsc(NoteEntity::getId)
                    .last("LIMIT " + REINDEX_BATCH_SIZE + " OFFSET " + offset));
            if (notes.isEmpty()) {
                break;
            }
            List<NoteSearchDoc> docs = notes.stream().map(NoteSearchDoc::from).toList();
            noteSearchRepository.saveAll(docs);
            indexed += docs.size();
            log.info("reindex 回灌中 offset={} batch={}", offset, docs.size());
        }
        log.info("笔记索引重建完成 indexed={}", indexed);
        return indexed;
    }

    /**
     * 把 ES 命中回填成卡片 VO：
     * 1) IN 查笔记本体（过滤已被删/状态变了的）；2) IN 查作者；
     * 3) 批量算「当前用户是否关注作者」；4) 严格按 ES 命中顺序输出。
     */
    private List<NoteListItemVO> hydrate(SearchHits<NoteSearchDoc> hits, Long currentUserId) {
        List<String> orderedIds = hits.getSearchHits().stream()
                .map(h -> h.getContent().getId())
                .toList();
        if (orderedIds.isEmpty()) {
            return List.of();
        }

        List<Long> ids = orderedIds.stream().map(Long::parseLong).toList();
        Map<Long, NoteEntity> byId = noteMapper.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(NoteEntity::getId, Function.identity()));

        // 只在索引里、库里没了或状态已不是 1 的，一律 drop：搜索结果跟着 DB 走
        List<NoteEntity> kept = orderedIds.stream()
                .map(id -> byId.get(Long.valueOf(id)))
                .filter(Objects::nonNull)
                .filter(n -> Objects.equals(n.getStatus(), STATUS_PUBLISHED))
                .toList();

        List<Long> authorIds = kept.stream().map(NoteEntity::getUserId).distinct().toList();
        Map<Long, UserVO> users = userQueryService.findUserVOMap(authorIds);
        Set<Long> following = userFollowQueryService.batchFollowingIds(currentUserId, authorIds);

        // P8：搜索结果卡片计数以 Redis 为准（整页一次 pipeline），缺失的保持 DB 现值
        counterStore.applyCounts(kept);
        return kept.stream()
                .map(note -> NoteConverter.toListItemVO(note,
                        users.get(note.getUserId()),
                        following.contains(note.getUserId())))
                .toList();
    }
}