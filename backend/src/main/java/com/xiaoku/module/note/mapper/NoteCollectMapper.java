package com.xiaoku.module.note.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.note.entity.NoteCollectEntity;
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
}