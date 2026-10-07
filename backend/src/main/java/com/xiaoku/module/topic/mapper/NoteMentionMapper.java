package com.xiaoku.module.topic.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.topic.entity.NoteMentionEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/** 笔记提及（@某人），对应 note_mention 表 */
@Mapper
public interface NoteMentionMapper extends BaseMapper<NoteMentionEntity> {

    @Select("SELECT user_id FROM note_mention WHERE note_id = #{noteId}")
    List<Long> selectUserIds(@Param("noteId") Long noteId);
}