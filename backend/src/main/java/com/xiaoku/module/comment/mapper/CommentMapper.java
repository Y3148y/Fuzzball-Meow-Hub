package com.xiaoku.module.comment.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.comment.entity.CommentEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface CommentMapper extends BaseMapper<CommentEntity> {

    /**
     * 评论点赞数 +1。
     *
     * <p>评论的计数不像笔记那样走 Redis（互动量级差几个数量级），
     * 直接在行上 ±1 就够，注释刻意点明这个取舍。
     */
    @Update("UPDATE comment SET like_count = like_count + 1 WHERE id = #{commentId}")
    int increaseLikeCount(@Param("commentId") Long commentId);

    /**
     * 评论点赞数 -1，带 GREATEST 兜底防并发取消把计数压成负数。
     */
    @Update("UPDATE comment SET like_count = GREATEST(0, like_count - 1) WHERE id = #{commentId}")
    int decreaseLikeCount(@Param("commentId") Long commentId);
}
