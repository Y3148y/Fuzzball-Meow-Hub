package com.xiaoku.module.note.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.note.entity.NoteEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface NoteMapper extends BaseMapper<NoteEntity> {

    /**
     * 点赞数 ±1。
     *
     * <p><b>刻意写成 {@code like_count = like_count + 1} 这样的单条原子 SQL</b>，
     * 而不是「先 select 出计数 → Java 里 +1 → update 写回」。
     * 后者在并发下必然丢计数：A 和 B 同时读到 10，各自算出 11，
     * 最后写回 11，点赞了两次却只记了 1。把加减法交给数据库的
     * 行锁（InnoDB 对同一行的 UPDATE 会串行化）才不会丢。
     *
     * <p>另外注意<b>不能</b>用 MyBatis-Plus 的 {@code lambdaUpdate().set(...)}：
     * 那是「把这个字段设为某个值」，语义和自增不同，仍需先读后写。
     *
     * @param delta +1 或 -1
     * @return 受影响行数；0 表示笔记不存在
     */
    @Update("UPDATE note SET like_count = like_count + #{delta} WHERE id = #{noteId}")
    int updateLikeCount(@Param("noteId") Long noteId, @Param("delta") int delta);

    /** 收藏数 ±1，同 {@link #updateLikeCount} 的理由 */
    @Update("UPDATE note SET collect_count = collect_count + #{delta} WHERE id = #{noteId}")
    int updateCollectCount(@Param("noteId") Long noteId, @Param("delta") int delta);

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
