package com.xiaoku.module.feed.mapper;

import com.xiaoku.module.note.entity.NoteEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 关注流专用 Mapper。
 *
 * <p>关注流的查询是 {@code note JOIN user_follow}：note 表没有 {@code deleted}
 * 逻辑删列（用 status 表达生命周期），而 user_follow 的 {@code status} 是
 * 1已关注 / 2已取关，所以：
 * <ul>
 *     <li>JOIN 条件里带 {@code f.status = 1}：软状态语义哪怕将来启用也能截住取关行；</li>
 *     <li>外层 {@code n.status = 1}：只给「已发布」的笔记引流，草稿/下架不出现。</li>
 * </ul>
 *
 * <p><b>为什么用 JOIN 而不是 {@code IN (SELECT follow_id FROM user_follow WHERE user_id=?)}：</b>
 * 关注到千级用户时 IN 列表会爆炸、单条 SQL 变得巨大；
 * JOIN 把「我关注了谁」和「TA 发了什么」合并成一次索引查询。
 * 分页不需要子查询包装：JOIN 后按时间倒序 + LIMIT/OFFSET 即可，
 * COUNT 是单独一条轻量查询。
 */
@Mapper
public interface FeedMapper {

    @Select("""
            <script>
            SELECT COUNT(*)
            FROM note n
            INNER JOIN user_follow f
                    ON n.user_id = f.follow_id AND f.user_id = #{userId} AND f.status = 1
            WHERE n.status = 1
                <if test="hiddenIds != null and !hiddenIds.isEmpty()">
                    AND n.user_id NOT IN
                    <foreach collection="hiddenIds" item="id" open="(" separator="," close=")">#{id}</foreach>
                </if>
            </script>
            """)
    long countFollowFeed(@Param("userId") Long userId,
                           @Param("hiddenIds") java.util.Collection<Long> hiddenIds);

    @Select("""
            <script>
            SELECT n.*
            FROM note n
            INNER JOIN user_follow f
                    ON n.user_id = f.follow_id AND f.user_id = #{userId} AND f.status = 1
            WHERE n.status = 1
              <if test="hiddenIds != null and !hiddenIds.isEmpty()">
                  AND n.user_id NOT IN
                  <foreach collection="hiddenIds" item="id" open="(" separator="," close=")">#{id}</foreach>
              </if>
            ORDER BY n.create_time DESC, n.id DESC
            LIMIT #{size} OFFSET #{offset}
            </script>
            """)
    List<NoteEntity> pageFollowFeed(@Param("userId") Long userId,
                                    @Param("offset") long offset,
                                    @Param("size") int size,
                          @Param("hiddenIds") java.util.Collection<Long> hiddenIds);

    /**
     * P23 热度分（可解释的第一版）
     *
     * <p><b>公式</b>：{@code (1 + 3·赞 + 4·藏 + 5·评) / (发布天数 + 7) ^ 0.5}
     *
     * <p><b>为什么是这个形状</b> —— 每个常数都是对着真数据量出来的，不是抄来的：
     * <ul>
     *   <li><b>常数 1 的基线</b>：让零互动内容也有正的分数，否则 {@code ORDER BY} 会
     *       把它们与 NULL 混在一起，而新内容永远出不来。</li>
     *   <li><b>权重 3/4/5</b>：评论比点赞贵（评论要打字、还产生通知与订阅），
     *       收藏比点赞贵（收藏是「我要回来看」的信号）。权重之间的差距刻意不大 ——
     *       当前库里最大的互动量只有 6，再放大权重只会让排序退化成「谁赞多谁赢」。</li>
     *   <li><b>天数 + 7</b>：一周内的年龄差异**几乎不影响**排序（除数从 7 到 14
     *       只差 1.41 倍，而互动从 0 到 6 差 19 倍）。这保证「3 天前的 4 互动」
     *       能压过「9 天前的 3 互动」，但压不过「9 天前的 6 互动」。</li>
     *   <li><b>指数 0.5</b>：开方。指数 1.5（Hacker News 的经典值）在本项目实测
     *       会把排序<b>整个翻转</b> —— 见下方「照抄 HN 会怎样」。</li>
     * </ul>
     *
     * <p><b>照抄 Hacker News 会怎样（2026-10-10 实测）</b>：
     * HN 的 {@code (1+3L+4C+5Cm) / (age_hours+2)^1.5} 在本项目是错的，因为
     * <b>两个信号的量级完全不匹配</b>：互动量只有 0~6（分子 1~30），
     * 而年龄跨度是 0~216 小时（除数 2.9~3240）。衰减比互动强两个数量级，
     * 于是「5 小时前发的零互动测试笔记」以 0.054 分压过
     * 「9 天前的 6 互动内容」（0.006 分）—— 前 8 名**全是**刚发的零互动内容，
     * 排序等于失效。把指数降到 0.5、并把年龄单位从小时改成天之后才配平。
     *
     * <p><b>热度分那句 SQL 里刻意一行注释都不写</b>：Druid 的 wall filter
     * （{@code druid-version 1.2.28}）默认<b>拒绝带注释的 SQL</b>，会抛
     * {@code SQLException: sql injection violation, comment not allow}。
     * 报错说的是「SQL 注入」，与真因（我写了 {@code --} 注释）隔了整整一层，
     * 而症状只是「接口返 100999」。本项目的 SQL 注释一律写在 Java 侧。
     *
     * <p><b>为什么刻意不建物化列</b>：AGENTS 记的实测是 discover p95 ≈ 80~97ms，
     * 远低于项目自己的 600ms 预算；库内 299 篇笔记。物化 {@code hot_score} 列
     * 要付出「异步刷列 + 漂移」的<b>确定成本</b>（时间衰减项会随时间变，
     * 光靠计数刷新的钩子刷不干净，得再加一个周期性 decay job），
     * 换一个当下量不出来的收益。**重测的触发条件**：笔记数 &gt; 5000
     * 或 discover p95 &gt; 200ms —— 届时把上面那段 SQL 换成一个列即可，
     * 排序语义完全不变。
     */

    /* ==================== 发现流 ==================== */

    /**
     * 发现流总数：<b>排除自己发的</b>（小红书的发现页也不回显自己的笔记）。
     *
     * <p>与关注流不同，这里查的是全站 {@code status = 1} 的笔记，所以
     * 「没关注任何人」的新用户也能看到内容 —— 这正是补这个流的目的。
     */
    @Select("""
            <script>
            SELECT COUNT(*)
            FROM note n
            WHERE n.status = 1
                <if test="hiddenIds != null and !hiddenIds.isEmpty()">
                    AND n.user_id NOT IN
                    <foreach collection="hiddenIds" item="id" open="(" separator="," close=")">#{id}</foreach>
                </if> AND n.user_id != #{userId}
            </script>
            """)
    long countDiscover(@Param("userId") Long userId,
                         @Param("hiddenIds") java.util.Collection<Long> hiddenIds);

    /**
     * 发现流排序，三级依次比较：
     * <ol>
     *   <li><b>关注优先</b>：自己关注过的作者排前面（前端靠 {@code authorFollowed} 打标记）</li>
     *   <li><b>热度分</b>（P23）：见下面的 {@link #HOT_SCORE_SQL}</li>
     *   <li><b>最新补位</b>：同分按发布时间倒序，再同分按 id 倒序（雪花 ID 单调，倒序即最新且稳定）</li>
     * </ol>
     *
     * <p><b>互动量读的是 note 表的三个计数列，而它们是 Redis 权威值的异步落库产物</b>
     * （P8 的 {@code NoteCounterFlushJob} 每 30s 刷一次）。所以刚发的笔记在最长 30s 内
     * 互动量按旧值参与排序，随后自动纠正。这里刻意不逐条 ZCARD：发现流一页 20 条，
     * 为了排序去读 3 个 ZSet 的全部成员，代价远大于排序本身。
     */
    @Select("""
            <script>
            SELECT n.*
            FROM note n
            WHERE n.status = 1 AND n.user_id != #{userId}
              <if test="hiddenIds != null and !hiddenIds.isEmpty()">
                  AND n.user_id NOT IN
                  <foreach collection="hiddenIds" item="id" open="(" separator="," close=")">#{id}</foreach>
              </if>
            ORDER BY (EXISTS (SELECT 1 FROM user_follow f
                             WHERE f.user_id = #{userId} AND f.follow_id = n.user_id AND f.status = 1)) DESC,
                    (1 + 3 * n.like_count + 4 * n.collect_count + 5 * n.comment_count)
                      / POW(TIMESTAMPDIFF(HOUR, n.create_time, NOW()) / 24 + 7, 0.5) DESC,
                    n.create_time DESC,
                    n.id DESC
            LIMIT #{size} OFFSET #{offset}
            </script>
            """)
    List<NoteEntity> pageDiscover(@Param("userId") Long userId,
                                  @Param("offset") long offset,
                                  @Param("size") int size,
                                  @Param("hiddenIds") java.util.Collection<Long> hiddenIds);
}