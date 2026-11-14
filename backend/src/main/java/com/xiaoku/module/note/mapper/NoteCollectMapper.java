package com.xiaoku.module.note.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.note.entity.NoteCollectEntity;
import com.xiaoku.module.note.entity.NoteEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/** 收藏关系，对应 note_collect 表 */
@Mapper
public interface NoteCollectMapper extends BaseMapper<NoteCollectEntity> {

    /** 某篇笔记的全部收藏人 userId（P8 用于按 DB 关系行重建 Redis ZSET） */
    @Select("SELECT user_id FROM note_collect WHERE note_id = #{noteId}")
    List<Long> selectUserIds(@Param("noteId") Long noteId);

    /**
     * 我收藏的笔记（收藏夹列表），按收藏时间倒序
     *
     * <p><b>为什么JOIN note 而不是只查 note_collect</b>：收藏夹要显示封面/标题/计数，
     * 那些只在note 上；JOIN 一次比查两次省一个 RTT。
     *
     * <p>{@code n.status = 1}：已下架的笔记不进收藏夹 —— 点进去会撞 20002，
     * 给一个点不开的条目不如不显示。笔记被删除时收藏行由
     * {@code NoteServiceImpl.delete} 级联清掉，这里自然查不到。
     */
    @Select("""
            SELECT n.*
            FROM note_collect c
            INNER JOIN note n ON n.id = c.note_id
            WHERE c.user_id = #{userId} AND n.status = 1
            ORDER BY c.create_time DESC, c.id DESC
            LIMIT #{size} OFFSET #{offset}
            """)
    List<NoteEntity> pageCollectedNotes(@Param("userId") Long userId,
                                        @Param("offset") long offset,
                                        @Param("size") int size);

    @Select("""
            SELECT COUNT(*)
            FROM note_collect c
            INNER JOIN note n ON n.id = c.note_id
            WHERE c.user_id = #{userId} AND n.status = 1
            """)
    long countCollectedNotes(@Param("userId") Long userId);
}