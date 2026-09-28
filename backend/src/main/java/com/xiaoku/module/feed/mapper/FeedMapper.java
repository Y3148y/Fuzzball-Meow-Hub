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
            SELECT COUNT(*)
            FROM note n
            INNER JOIN user_follow f
                    ON n.user_id = f.follow_id AND f.user_id = #{userId} AND f.status = 1
            WHERE n.status = 1
            """)
    long countFollowFeed(@Param("userId") Long userId);

    @Select("""
            SELECT n.*
            FROM note n
            INNER JOIN user_follow f
                    ON n.user_id = f.follow_id AND f.user_id = #{userId} AND f.status = 1
            WHERE n.status = 1
            ORDER BY n.create_time DESC, n.id DESC
            LIMIT #{size} OFFSET #{offset}
            """)
    List<NoteEntity> pageFollowFeed(@Param("userId") Long userId,
                                    @Param("offset") long offset,
                                    @Param("size") int size);
}