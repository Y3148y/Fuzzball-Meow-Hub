package com.xiaoku.common.support;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 笔记 ID 布隆过滤器 —— 防缓存穿透。
 *
 * <p><b>要挡的攻击</b>：爬虫拿到接口后把 ID 从 1 扫到 10^9。这些 ID 绝大多数不存在，
 * 于是每一个都「缓存不命中 → 打 MySQL → 也不命中」。缓存不但没帮上忙，
 * 反而把本该缓存命中读请求的数据库连接全占掉了，真实用户跟着一起卡住。
 *
 * <p><b>为什么正向布隆就够了</b>：这里只放「<b>存在</b>的笔记 ID」，
 * 判定为「一定不存在」就直接返回 20001，压根不碰缓存和 MySQL。
 * 前提是这个过滤器**完整**，所以有两条写入路径：
 * <ol>
 *     <li>发布成功时置位（{@link com.xiaoku.module.note.service.NoteService} 里调）；</li>
 *     <li>启动时从 MySQL 全量回灌（{@link #warmUp}），
 *         兜住「过滤器比数据新」和「事件丢了」这两种情况。</li>
 * </ol>
 *
 * <p><b>置位时机故意放在事务提交之前</b>：布隆的误判方向是「说存在但其实不存在」
 * （假阳性），只会让请求多查一次库；而「说不存在但其实存在」（假阴性）会让<b>真实笔记
 * 直接 404</b>。所以宁可提前置位、承担假阳性，也不能漏置位。
 *
 * <p><b>warmUp 完成前一律不拦</b>（{@link #isWarm()} 为 false 时不过滤）：
 * 过滤器是空的，此时任何一次误拦都是线上可见的 404。宁可这段时间没有保护，
 * 也不能用「可能出错」换「理论性能」。Redis 挂了同样退回不拦 —— 见 {@link #mightContain}。
 *
 * <p><b>存储用 {@code SETBIT/GETBIT} 而不是 RedisBloom 模块</b>：官方模块要额外编译
 * 装进容器，本机 redis:7-alpine 里 {@code MODULE LIST} 是空的。一个位图就够了，
 * 纯 SETBIT/GETBIT 没有任何依赖，插不进模块的环境也能跑。
 */
@Slf4j
@Component
public class NoteIdBloomFilter {

    /**
     * 哈希算法用 FNV-1a 64 位：非加密哈希里质量够用、实现只有几行。
     * 不引 Guava / commons-codec 就是为了这个 —— 整个项目只有这一处需要哈希。
     */
    private static final long FNV_OFFSET_BASIS = 0xcbf29ce484222325L;
    private static final long FNV_PRIME = 0x100000001b3L;

    private final StringRedisTemplate redisTemplate;
    private final String key;
    private final int bitCount;
    private final int hashCount;

    /** 回灌是否完成。没完成之前不过滤，理由见类注释 */
    private volatile boolean warm = false;

    public NoteIdBloomFilter(StringRedisTemplate redisTemplate,
                             @Value("${xiaoku.bloom.note-id.key:xk:bloom:note:id}") String key,
                             @Value("${xiaoku.bloom.note-id.bits:16777216}") int bitCount,
                             @Value("${xiaoku.bloom.note-id.hash-count:4}") int hashCount) {
        this.redisTemplate = redisTemplate;
        this.key = key;
        this.bitCount = bitCount;
        this.hashCount = hashCount;
    }

    /**
     * 把一个 ID 写进过滤器。
     *
     * <p>Pipeline 批量置位：一次网络往返发 k 条命令，而不是 k 次。
     */
    public void add(Long noteId) {
        try {
            // 关键守卫：位图被外部清过（FLUSHDB / 容器重启 / 被驱逐）后，
            // 这里要是照常置位，等于用一个「只剩这篇新笔记」的残缺位图顶替全量位图，
            // mightContain 一旦信任它，<b>所有更早的笔记都会被误判成不存在</b>。
            // 篡改失败就降级：把 warm 拉回 false，直到重启后 warmUp 全量回灌。
            if (Boolean.FALSE.equals(redisTemplate.hasKey(key))) {
                warm = false;
                log.error("布隆位图缺失但收到置位请求（id={}），过滤器已降级为不过滤——请勿在外部清理这个 key，恢复需重启 warmUp", noteId);
                return;
            }
            List<Long> offsets = offsets(noteId);
            redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
                for (Long offset : offsets) {
                    connection.stringCommands().setBit(keyBytes(), offset, true);
                }
                return null;
            });
        } catch (RuntimeException e) {
            // 漏置位 = 过滤器不完整 = 真实笔记可能被误判成不存在。
            // 这是本类唯一不能吞掉的失败，必须打出来（下一条 warn 会给出处置建议）
            log.error("笔记 ID 置位失败 id={}，该笔记可能被详情接口误判为 20001，需重新 warmUp", noteId, e);
        }
    }

    /**
     * 判断「可能存在」。
     *
     * @return false = <b>一定不存在</b>；true = 可能存在（也可能是假阳性，得查库）
     */
    public boolean mightContain(Long noteId) {
        if (!warm) {
            return true;
        }
        try {
            // 关键守卫：位图这个 key 在不在。
            // warm 标志在进程内，而位图数据在 Redis 里——这两者会脱节：
            // FLUSHDB / Redis 容器重启 / 逐出策略都会让「进程以为过滤器已就绪、
            // 位图实际全空」。此时 GETBIT 返回 0 会误判成「一定不存在」，
            // 结果就是<b>所有真实笔记详情直接 404</b>，比没有过滤器严重得多。
            // 位图是整 key 原子存在的，EXISTS 能可靠代表它的存亡。
            if (Boolean.FALSE.equals(redisTemplate.hasKey(key))) {
                log.warn("布隆位图缺失（key={}），退回不过滤：请重新 warmUp / 不要外部清这个 key", key);
                return true;
            }
            for (Long offset : offsets(noteId)) {
                Boolean bit = redisTemplate.opsForValue().getBit(key, offset);
                if (!Boolean.TRUE.equals(bit)) {
                    return false;
                }
            }
            return true;
        } catch (RuntimeException e) {
            // Redis 不可用时一律放行：过滤器是优化，不是正确性的一部分。
            // 反过来 fail-close 会让一次 Redis 抖动直接变成全站笔记 404
            log.warn("布隆过滤器查询失败，本次不过滤 id={}", noteId, e);
            return true;
        }
    }

    public boolean isWarm() {
        return warm;
    }

    /**
     * 从 MySQL 全量回灌，把过滤器补成完整的。
     *
     * @param noteIds 库中所有笔记 ID
     * @return 实际置位的条数
     */
    public int warmUp(List<Long> noteIds) {
        try {
            if (noteIds.isEmpty()) {
                // 空库也要置 warm：否则每次请求都走「不过滤」分支，
                // 而空库时正确行为恰恰是「全部 20001」，此时不过滤毫无损失
                warm = true;
                return 0;
            }
            // 分批：一次 pipeline 塞几万个 setBit 会让 Redis 单线程卡很久
            int batch = 2000;
            for (int i = 0; i < noteIds.size(); i += batch) {
                List<Long> chunk = noteIds.subList(i, Math.min(i + batch, noteIds.size()));
                redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
                    for (Long id : chunk) {
                        for (Long offset : offsets(id)) {
                            connection.stringCommands().setBit(keyBytes(), offset, true);
                        }
                    }
                    return null;
                });
            }
            warm = true;
            log.info("笔记 ID 布隆过滤器回灌完成，共 {} 条，{} bit / {} 哈希函数", noteIds.size(), bitCount, hashCount);
            return noteIds.size();
        } catch (RuntimeException e) {
            // 回灌失败就保持未就绪：过滤器空着只是没保护，不影响正确性
            warm = false;
            log.error("布隆过滤器回灌失败，本次运行不过滤（笔记详情仍会查库）", e);
            return 0;
        }
    }

    /** 清空重来。改了 bitCount 必须重来：位下标依赖 bitCount，改了之后老位全部错位 */
    public void reset() {
        try {
            redisTemplate.delete(key);
            warm = false;
        } catch (RuntimeException e) {
            log.warn("清空布隆过滤器失败 key={}", key, e);
        }
    }

    /** 实际占用的字节数（bit/8），用来观察内存代价 */
    public long sizeInBytes() {
        try {
            String value = redisTemplate.opsForValue().get(key);
            return value == null ? 0L : value.length();
        } catch (RuntimeException e) {
            return 0L;
        }
    }

    /**
     * 算 k 个位下标。
     *
     * <p>用 Kirsch-Mitzenmacher 双散列：{@code h(i) = h1 + i * h2 (mod m)}。
     * 真实的 k 个独立哈希函数要算 k 遍，而两个哈希就能逼近同样的分布，
     * 代价从 O(k) 次哈希降到 2 次。前提是 h1、h2 相互独立且 h2 非 0 ——
     * 所以 h2 额外混了一个固定盐。
     */
    private List<Long> offsets(Long noteId) {
        byte[] bytes = String.valueOf(noteId).getBytes(StandardCharsets.UTF_8);
        long h1 = fnv1a(bytes, FNV_OFFSET_BASIS);
        long h2 = fnv1a(bytes, FNV_OFFSET_BASIS) ^ 0x9e3779b97f4a7c15L;
        if (h2 == 0) {
            h2 = 0x9e3779b97f4a7c15L;
        }
        long[] offsets = new long[hashCount];
        for (int i = 0; i < hashCount; i++) {
            offsets[i] = Math.floorMod(h1 + i * h2, bitCount);
        }
        return java.util.Arrays.stream(offsets).boxed().toList();
    }

    private static long fnv1a(byte[] data, long basis) {
        long hash = basis;
        for (byte b : data) {
            hash ^= (b & 0xff);
            hash *= FNV_PRIME;
        }
        return hash;
    }

    /** SETBIT 要的是二进制安全的 key，走底层 connection 时得自己序列化 */
    private byte[] keyBytes() {
        return key.getBytes(StandardCharsets.UTF_8);
    }
}
