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
 */
@Mapper
public interface NoteLikeMapper extends BaseMapper<NoteLikeEntity> {

    /** 某篇笔记的全部点赞人 userId（P8 用于按 DB 关系行重建 Redis ZSET） */
    @Select("SELECT user_id FROM note_like WHERE note_id = #{noteId}")
    List<Long> selectUserIds(@Param("noteId") Long noteId);
}