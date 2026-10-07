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
     *   <li><b>互动量</b>：赞 + 藏 + 评，三项相加降序</li>
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
                     (n.like_count + n.collect_count + n.comment_count) DESC,
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