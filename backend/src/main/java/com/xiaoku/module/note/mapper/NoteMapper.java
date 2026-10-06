package com.xiaoku.module.note.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.note.entity.NoteEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.Collection;
import java.util.List;

@Mapper
public interface NoteMapper extends BaseMapper<NoteEntity> {

    /**
     * 只取 id + title 的轻量批量查询
     *
     * <p>通知列表要显示「来自哪篇笔记」，但通知表只冗余了 note_id，没有标题。
     * 这里刻意**不**用 {@code selectBatchIds}：那会把 content 等大字段全捞出来
     * （一行几百 KB），而列表页只需要标题两个字。只 SELECT 两列，未选中的字段
     * 保持 null，调用方只该读 id 与 title。
     *
     * @param noteIds 笔记ID集合，调用方保证非空（空集合会拼出非法 IN ()）
     */
    @Select("""
            <script>
            SELECT id, title FROM note WHERE id IN
            <foreach collection="noteIds" item="n" open="(" separator="," close=")">#{n}</foreach>
            </script>
            """)
    List<NoteEntity> selectTitlesByIds(@Param("noteIds") Collection<Long> noteIds);

    /**
     * 按绝对值覆盖点赞/收藏计数（P8 对账用，取代旧的 ±1 逐次 UPDATE）。
     *
     * <p>动态 {@code <set>}：只更新非 null 的那一列，避免把「某一边集合缺失」时的
     * 缺失值当成 0 写坏另一边。计数权威在 Redis ZSet，DB 这边由
     * {@code NoteCounterFlushJob} 定期对账，绝对值覆盖天然幂等——
     * 上一轮死在任何位置，重跑结果都一样（这正是增量累加做不到的）。
     *
     * <p>旧方法：{@code like_count = like_count + 1} 靠 DB 行锁防并发丢数，
     * 但每次互动都打一次这一行，压力全在单行 UPDATE 上。P8 改为
     * 「DB 关系行（唯一索引当裁判）→ Redis ZSet（计数）→ 定期对账落回 DB」，
     * 写入只碰 Redis（ZADD/ZREM + SREM 打脏），读只读 Redis，
     * DB 计数列成为可容忍 <30s 延迟的底账。旧的 {@code updateLikeCount}
     * 也就是上面那个语义，已被 {@link #updateCountsAbs} 取代。
     */
    @Update("""
            <script>
            UPDATE note
            <set>
              <if test="like != null">like_count = #{like},</if>
              <if test="collect != null">collect_count = #{collect},</if>
            </set>
            WHERE id = #{noteId}
            </script>
            """)
    int updateCountsAbs(@Param("noteId") Long noteId,
                        @Param("like") Integer like,
                        @Param("collect") Integer collect);

    /** 评论数 +1 */
    @Update("UPDATE note SET comment_count = comment_count + 1 WHERE id = #{noteId}")
    int increaseCommentCount(@Param("noteId") Long noteId);

    /**
     * 评论数 -delta。
     *
     * <p>带 GREATEST(0, ...) 兜底，防止并发删除把计数压成负数。
     * delta 是负数，所以 GREATEST 取 0 和现值的较大者。
     *
     * <p>删根评论时是「自己 + 全部子回复」一起消失，所以 delta 是批量算好的，
     * <b>而不是在 Java 里循环调多次</b>——那样每次都是一条独立 UPDATE，
     * 中间失败就会留下计数对不上的状态。
     */
    @Update("UPDATE note SET comment_count = GREATEST(0, comment_count + #{delta}) WHERE id = #{noteId}")
    int decreaseCommentCount(@Param("noteId") Long noteId, @Param("delta") int delta);
}
