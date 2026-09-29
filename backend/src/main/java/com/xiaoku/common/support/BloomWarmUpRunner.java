package com.xiaoku.common.support;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 布隆过滤器启动回灌。
 *
 * <p>为什么要单独一个类而不是在过滤器自己监听启动事件：过滤器不该知道 NoteMapper 的存在。
 * 它只提供 {@code warmUp(List<Long>)}，「从哪来这批 ID」是应用组装层的事。
 *
 * <p>注意这<b>不是</b> {@code @Scheduled}，是启动时跑一次。
 * 做成定时任务看似能自动修复漂移，实际上会在业务运行时周期性全表扫 ID，
 * 那点开销和收益不成比例；而正确性已经由「发布时置位」保证，
 * 这里只是为了补上过滤器建立<b>之前</b>就已经存在的那批数据。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class BloomWarmUpRunner {

    private final NoteMapper noteMapper;
    private final NoteIdBloomFilter bloomFilter;

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        try {
            // 只要 id 一列，不查整行：全表扫的行宽会放大网络和内存开销
            List<NoteEntity> notes = noteMapper.selectList(
                    Wrappers.<NoteEntity>lambdaQuery().select(NoteEntity::getId));
            bloomFilter.warmUp(notes.stream().map(NoteEntity::getId).toList());
        } catch (Exception e) {
            // 启动期 MySQL 还没起来是常见情况。不阻断启动：过滤器没就绪只是失去一层保护，
            // 详情接口会老老实实查库，功能不受影响
            log.warn("布隆过滤器启动回灌跳过（笔记详情接口将不经过滤）", e);
        }
    }
}
