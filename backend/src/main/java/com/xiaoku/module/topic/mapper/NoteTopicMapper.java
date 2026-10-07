package com.xiaoku.module.topic.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.topic.entity.NoteTopicEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/** 笔记-话题关系，对应 note_topic 表 */
@Mapper
public interface NoteTopicMapper extends BaseMapper<NoteTopicEntity> {

    @Select("SELECT topic_id FROM note_topic WHERE note_id = #{noteId}")
    List<Long> selectTopicIds(@Param("noteId") Long noteId);
}