package com.xiaoku.module.note.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.note.entity.NoteLikeEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 点赞关系。P3 只需要它回答「当前用户是否已点赞」，
 * 真正的点赞/取消点赞在 P5。
 *
 * <p>P38 起多了一条反向查询：「我赞过哪些笔记」（个人主页的「赞过」Tab）。
 */
@Mapper
public interface NoteLikeMapper extends BaseMapper<NoteLikeEntity> {

    /** 某篇笔记的全部点赞人 userId（P8 用于按 DB 关系行重建 Redis ZSET） */
    @Select("SELECT user_id FROM note_like WHERE note_id = #{noteId}")
    List<Long> selectUserIds(@Param("noteId") Long noteId);

    /**
     * 我赞过的笔记，按点赞时间倒序
     *
     * <p>形状与 {@code NoteCollectMapper#pageCollectedNotes} 完全一致 ——
     * 那一条是「我的收藏夹」的同款查询（JOIN note 拿封面/标题/计数），
     * 这里照抄是为了两个 Tab 的行为一致（比如都只显示 status=1 的）。
     *
     * <p>{@code n.status = 1}：已下架/草稿的笔记不显示 —— 点进去会撞 20002，
     * 给一个点不开的条目不如不显示。取消点赞的关系行是**物理删**（P5），
     * 所以「取消过赞的笔记」自然不会出现在这里。
     */
    @Select("""
            SELECT n.*
            FROM note_like l
            INNER JOIN note n ON n.id = l.note_id
            WHERE l.user_id = #{userId} AND n.status = 1
            ORDER BY l.create_time DESC, l.id DESC
            LIMIT #{size} OFFSET #{offset}
            """)
    List<com.xiaoku.module.note.entity.NoteEntity> pageLikedNotes(@Param("userId") Long userId,
                                                                    @Param("offset") long offset,
                                                                    @Param("size") int size);

    @Select("""
            SELECT COUNT(*)
            FROM note_like l
            INNER JOIN note n ON n.id = l.note_id
            WHERE l.user_id = #{userId} AND n.status = 1
            """)
    long countLikedNotes(@Param("userId") Long userId);
}