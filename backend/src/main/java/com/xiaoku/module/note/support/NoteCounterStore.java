package com.xiaoku.module.note.support;

import com.xiaoku.common.constant.RedisKey;
import com.xiaoku.module.note.entity.NoteEntity;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * 笔记点赞/收藏计数的 Redis 读写端口（P8）。
 *
 * <p><b>设计：Redis 是计数的「当前权威」，MySQL 是「持久底账」，异步对账收敛。</b>
 *
 * <ul>
 *   <li><b>写</b>：DB 关系行（note_like / note_collect）照旧 insert/delete 当唯一裁判；
 *       计数不再走 {@code note.like_count ± 1} 的逐次 UPDATE，改成：
 *       ZSET 记成员 + 把笔记 ID 丢进 {@link RedisKey#NOTE_DIRTY} 待落库。
 *       点赞/取消清零服务端 30 次/分钟限流护体，量级下 Redis 扛得住。</li>
 *   <li><b>读</b>：ZCARD / ZSCORE 直接出数，不碰 DB 的计数列；列表页用 pipeline
 *       一次往返取整页。ZSET key 不存在（Redis 重启/清掉）时返回 {@code null}，
 *       调用方回退到 DB 列，绝不把「缓存丢了」当成「计数是 0」。</li>
 *   <li><b>收敛</b>：{@code NoteCounterFlushJob} 每 30s 把 DIRTY 里的笔记的
 *       ZCARD 绝对值写回 DB（不是累计增量，重跑/宕机都幂等）。
 *       顺带把缺失的 ZSET 从 DB 关系行重建——读写双向都能自愈。</li>
 *   <li><b>降级</b>：Redis 任何一步失败都记日志放行，读回退 DB、写交给后续
 *       对账收敛，不因缓存抖一下就把点赞请求直接打错。</li>
 * </ul>
 *
 * <p><b>为什么懒重建而不是裸 ZADD：</b>Redis FLUSHALL / 重启后 ZSET 全空。
 * 此时新来一个点赞若只 ZADD 一个成员，这个 ZSET 就会变成「只有这一人」的
 * 残缺集合，ZCARD 把别的老赞全算没了。所以写路径先查 key 在不在，
 * 不在就用 DB 关系行全量重建再落本次变更。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NoteCounterStore {

    private static final double MEMBER_SCORE = 1.0;

    private final RedisTemplate<String, String> redisTemplate;

    // ---------------------------------------------------------------- 写路径

    /** 点赞：ZSET 置位 + 打脏。likers 是 DB 里的当前点赞人（key 缺失时用于重建） */
    public void like(Long noteId, Long userId, Supplier<List<Long>> likers) {
        mutate(RedisKey.NOTE_LIKE_USERS, noteId, RuntimeMember.add(String.valueOf(userId)), likers);
        markDirty(noteId);
    }

    /** 取消点赞：ZSET 移除 + 打脏。likers 是 DB 移除后的当前点赞人（key 缺失时重建） */
    public void unlike(Long noteId, Long userId, Supplier<List<Long>> likers) {
        mutate(RedisKey.NOTE_LIKE_USERS, noteId, RuntimeMember.remove(String.valueOf(userId)), likers);
        markDirty(noteId);
    }

    /** 收藏，语义同 {@link #like} */
    public void collect(Long noteId, Long userId, Supplier<List<Long>> collectors) {
        mutate(RedisKey.NOTE_COLLECT_USERS, noteId, RuntimeMember.add(String.valueOf(userId)), collectors);
        markDirty(noteId);
    }

    /** 取消收藏，语义同 {@link #unlike} */
    public void uncollect(Long noteId, Long userId, Supplier<List<Long>> collectors) {
        mutate(RedisKey.NOTE_COLLECT_USERS, noteId, RuntimeMember.remove(String.valueOf(userId)), collectors);
        markDirty(noteId);
    }

    /** 把笔记 ID 扔进待落库集合。计数对账任务按它批量拿绝对值刷回 DB */
    public void markDirty(Long noteId) {
        try {
            redisTemplate.opsForSet().add(RedisKey.NOTE_DIRTY, String.valueOf(noteId));
        } catch (RuntimeException e) {
            log.warn("标记待落库失败 noteId={}（Redis 不可用？），本次变更留待下一次对账自愈", noteId, e);
        }
    }

    /**
     * 笔记删除时清掉计数与待落库痕迹（P11）。
     *
     * <p>赞/收藏 ZSet 的 key 整个删掉即可——读路径会回退 DB 关系行，
     * 而关系行已随笔记级联删除；脏标记也一并 SREM，免得 {@code NoteCounterFlushJob}
     * 拿一个不存在的 ID 去空转。任一步失败都放行：DB 行删干净后，
     * 遗留键无非是几个死 key，对账任务也不会再找它。
     */
    public void removeCounters(Long noteId) {
        try {
            redisTemplate.delete(List.of(RedisKey.NOTE_LIKE_USERS + noteId, RedisKey.NOTE_COLLECT_USERS + noteId));
        } catch (RuntimeException e) {
            log.warn("清理点赞/收藏计数 key 失败 noteId={}（Redis 不可用？），DB 行已删，不影响结果", noteId, e);
        }
        try {
            redisTemplate.opsForSet().remove(RedisKey.NOTE_DIRTY, String.valueOf(noteId));
        } catch (RuntimeException e) {
            log.warn("清理待落库标记失败 noteId={}（Redis 不可用？）", noteId, e);
        }
    }

    /**
     * 取一批待落库 ID（SPOP，取走的就得本轮对账，防止多实例重复处理）。
     * @return 空集合表示没有脏数据
     */
    public List<String> drainDirty(int max) {
        try {
            List<String> popped = redisTemplate.opsForSet().pop(RedisKey.NOTE_DIRTY, max);
            return popped == null ? List.of() : popped;
        } catch (RuntimeException e) {
            log.warn("取待落库队列失败（Redis 不可用？），本轮对账跳过", e);
            return List.of();
        }
    }

    /** 对账完成后从 DIRTY 里移除（若已被 drainDirty 的 SPOP 取走则是幂等空操作） */
    public void clearDirty(Long noteId) {
        try {
            redisTemplate.opsForSet().remove(RedisKey.NOTE_DIRTY, String.valueOf(noteId));
        } catch (RuntimeException e) {
            // 清不掉就留着，下一轮再刷一次，无副作用
            log.warn("清理待落库标记失败 noteId={}", noteId, e);
        }
    }

    /**
     * ZSET 变更。分两步：key 缺失先重建（否则 ZADD 单个成员会把老成员全顶掉），
     * 再把本次变更合进去。整个重建-变更在失败时只记日志不抛——DB 行还在，
     * 读路径会自动回退、对账任务会兜底自愈。
     */
    private void mutate(String keyPrefix, Long noteId, RuntimeMember change,
                        Supplier<List<Long>> rebuildSource) {
        String actualKey = keyPrefix + noteId;
        try {
            boolean exists = Boolean.TRUE.equals(redisTemplate.hasKey(actualKey));
            if (!exists) {
                rebuild(actualKey, rebuildSource.get());
            }
            ZSetOperations<String, String> zset = redisTemplate.opsForZSet();
            if (change.add) {
                zset.add(actualKey, change.member, MEMBER_SCORE);
            } else {
                zset.remove(actualKey, change.member);
            }
        } catch (RuntimeException e) {
            log.warn("互动计数 Redis 写入失败 key={} member={} add={}，已放行（DB 行是底账）",
                    actualKey, change.member, change.add, e);
        }
    }

    /** key 缺失时用 DB 关系行重建整个 ZSET（pipeline 写入） */
    private void rebuild(String key, List<Long> members) {
        if (members == null || members.isEmpty()) {
            return;
        }
        redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
            for (Long member : members) {
                connection.zSetCommands().zAdd(key.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                        MEMBER_SCORE, String.valueOf(member).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            return null;
        });
    }

    // ---------------------------------------------------------------- 读路径

    /** 点赞数。key 不存在返回 null，调用方回退 DB 列 */
    public Long likeCount(Long noteId) {
        return cardinality(RedisKey.NOTE_LIKE_USERS, noteId);
    }

    /** 收藏数。key 不存在返回 null，调用方回退 DB 列 */
    public Long collectCount(Long noteId) {
        return cardinality(RedisKey.NOTE_COLLECT_USERS, noteId);
    }

    /** 当前用户是否已点赞。key 缺失或 Redis 不可用返回 null，由调用方回退 DB 关系行 */
    public Boolean isLiked(Long noteId, Long userId) {
        return isMember(RedisKey.NOTE_LIKE_USERS, noteId, userId);
    }

    /** 当前用户是否已收藏，语义同 {@link #isLiked} */
    public Boolean isCollected(Long noteId, Long userId) {
        return isMember(RedisKey.NOTE_COLLECT_USERS, noteId, userId);
    }

    /** 列表页整页覆盖计数：Redis 有数据就用 Redis，没有就保持实体上从 DB 读出来的原值 */
    public void applyCounts(List<NoteEntity> notes) {
        if (notes == null || notes.isEmpty()) {
            return;
        }
        try {
            List<Long> ids = notes.stream().map(NoteEntity::getId).toList();
            // 第一趟：确认哪些 key 真实存在（ZCARD 对缺失 key 也返回 0，
            // 必须用 EXISTS 区分「缓存丢了」和「确实没人点过」）
            Set<Long> likeAlive = new HashSet<>();
            Set<Long> collectAlive = new HashSet<>();
            List<Object> alive = redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
                for (Long id : ids) {
                    connection.keyCommands().exists(keyBytes(RedisKey.NOTE_LIKE_USERS, id));
                    connection.keyCommands().exists(keyBytes(RedisKey.NOTE_COLLECT_USERS, id));
                }
                return null;
            });
            for (int i = 0; i < ids.size(); i++) {
                if (Boolean.TRUE.equals(alive.get(2 * i))) likeAlive.add(ids.get(i));
                if (Boolean.TRUE.equals(alive.get(2 * i + 1))) collectAlive.add(ids.get(i));
            }
            // 第二趟：只对存在的 key 取 ZCARD（pipeline 一趟往返）
            Map<Long, Integer> like = new HashMap<>();
            Map<Long, Integer> collect = new HashMap<>();
            List<Long> likeAliveOrder = new ArrayList<>(likeAlive);
            List<Long> collectAliveOrder = new ArrayList<>(collectAlive);
            List<Object> likeCards = redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
                for (Long id : likeAliveOrder) {
                    connection.zSetCommands().zCard(keyBytes(RedisKey.NOTE_LIKE_USERS, id));
                }
                return null;
            });
            List<Object> collectCards = redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
                for (Long id : collectAliveOrder) {
                    connection.zSetCommands().zCard(keyBytes(RedisKey.NOTE_COLLECT_USERS, id));
                }
                return null;
            });
            for (int i = 0; i < likeAliveOrder.size(); i++) {
                if (likeCards.get(i) instanceof Long lv) {
                    like.put(likeAliveOrder.get(i), Math.toIntExact(lv));
                }
            }
            for (int i = 0; i < collectAliveOrder.size(); i++) {
                if (collectCards.get(i) instanceof Long cv) {
                    collect.put(collectAliveOrder.get(i), Math.toIntExact(cv));
                }
            }
            for (NoteEntity note : notes) {
                Integer l = like.get(note.getId());
                Integer c = collect.get(note.getId());
                if (l != null) note.setLikeCount(l);
                if (c != null) note.setCollectCount(c);
            }
        } catch (RuntimeException e) {
            log.warn("计数快照读取失败（Redis 不可用？），本页沿用 DB 计数", e);
        }
    }

    private Long cardinality(String keyPrefix, Long noteId) {
        try {
            String key = keyPrefix + noteId;
            if (Boolean.FALSE.equals(redisTemplate.hasKey(key))) {
                return null;
            }
            Long c = redisTemplate.opsForZSet().zCard(key);
            return c;
        } catch (RuntimeException e) {
            log.warn("计数读取失败 key={}（Redis 不可用？），回退 DB", keyPrefix + noteId, e);
            return null;
        }
    }

    private Boolean isMember(String keyPrefix, Long noteId, Long userId) {
        try {
            String key = keyPrefix + noteId;
            if (Boolean.FALSE.equals(redisTemplate.hasKey(key))) {
                return null;
            }
            Double score = redisTemplate.opsForZSet().score(key, String.valueOf(userId));
            return score != null;
        } catch (RuntimeException e) {
            log.warn("互动状态读取失败 key={}（Redis 不可用？），返回 null 让调用方回退 DB", keyPrefix + noteId, e);
            return null;
        }
    }

    // ---------------------------------------------------------------- 工具

    private static byte[] keyBytes(String keyPrefix, Long noteId) {
        return (keyPrefix + noteId).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    /** 本次变更：加成员 or 减成员 */
    private record RuntimeMember(boolean add, String member) {
        static RuntimeMember add(String member) {
            return new RuntimeMember(true, member);
        }

        static RuntimeMember remove(String member) {
            return new RuntimeMember(false, member);
        }
    }
}