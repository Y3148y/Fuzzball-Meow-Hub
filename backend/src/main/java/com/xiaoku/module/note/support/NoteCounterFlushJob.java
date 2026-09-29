package com.xiaoku.module.note.support;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.support.LockTemplate;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Set;

/**
 * 点赞/收藏计数落库任务（P8）。
 *
 * <p><b>职责：</b>把 Redis 里的当前计数（ZCARD）按<b>绝对值</b>刷回
 * {@code note.like_count / note.collect_count}，让 DB 对账上有权数据。
 *
 * <p><b>为什么绝对值而不是增量：</b>增量（flush 时读 delta 再累加）在
 * "读了数字但还没变更到库里就崩了"时会把同一个 delta 应用两遍，重跑不幂等。
 * 绝对值意味着「DB = Redis 现在的样子」，无论上一轮死在哪，重跑结果一致。
 *
 * <p><b>读-改-写不丢计数：</b>flush 算出 ZCARD 的瞬间可能又来了新点赞——
 * 那是个新的 ZADD + 又打了一次 DIRTY，下一轮会再刷一次。DB 短暂落后，
 * 但不会停留（drain 是 SPOP，取走的这一轮必刷，之后再来的一定有下一轮）。
 *
 * <p><b>为什么用 Redisson 锁：</b>将来多实例部署时，两个实例同时刷同一条
 * 记录没有正确性冲突（绝对值），但浪费且无意义，锁它取一位干活。
 * 锁不可用（Redis 挂了）时 {@code LockTemplate} 会 fail-open——反正此刻
 * 计数本来就读不出来，DB 上一轮的值就是保守正确的。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NoteCounterFlushJob {

    private static final String FLUSH_LOCK_KEY = "xiaoku:lock:note:counter-flush";

    private final NoteCounterStore counterStore;
    private final NoteMapper noteMapper;
    private final LockTemplate lockTemplate;

    @Value("${xiaoku.counter-flush.batch-size:200}")
    private int batchSize;

    /** 每 30s 一轮；首次等 15s，给启动期重建让路 */
    @Scheduled(
            fixedDelayString = "${xiaoku.counter-flush.interval-ms:30000}",
            initialDelayString = "${xiaoku.counter-flush.initial-delay-ms:15000}")
    public void flush() {
        try (LockTemplate.LockHandle held = lockTemplate.tryLock(FLUSH_LOCK_KEY, Duration.ZERO, Duration.ofMinutes(1))) {
            if (held == null) {
                log.info("上一轮计数落库还在跑，本轮跳过");
                return;
            }
            Set<String> dirty = new java.util.HashSet<>(counterStore.drainDirty(batchSize));
            if (dirty.isEmpty()) {
                return;
            }
            int done = 0;
            for (String idStr : dirty) {
                try {
                    if (flushOne(Long.parseLong(idStr))) {
                        done++;
                    }
                } catch (RuntimeException e) {
                    // 单条失败不拖垮整个批：下一条会再扫到它（失败时没 SREM 掉）
                    log.error("计数落库失败 noteId={}", idStr, e);
                }
            }
            log.info("计数落库完成：{} 条（本轮取 {} 条）", done, dirty.size());
        }
    }

    /**
     * 对账单篇笔记。
     * @return true 表示已处理（含「不存在的笔记」）；false 表示两边都没有数据可写
     */
    private boolean flushOne(long noteId) {
        Long like = counterStore.likeCount(noteId);
        Long collect = counterStore.collectCount(noteId);
        if (like == null && collect == null) {
            // Redis 里两个集合都不在：DB 上的值就是当前事实，不必动它。
            // 字典上的脏标记是残留，清掉即可。
            counterStore.clearDirty(noteId);
            return true;
        }
        counterStore.clearDirty(noteId);
        return noteMapper.updateCountsAbs(noteId,
                like == null ? null : Math.toIntExact(like),
                collect == null ? null : Math.toIntExact(collect)) >= 0;
    }
}