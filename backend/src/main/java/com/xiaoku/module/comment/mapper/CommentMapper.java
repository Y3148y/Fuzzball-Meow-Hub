package com.xiaoku.module.comment.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.comment.entity.CommentEntity;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface CommentMapper extends BaseMapper<CommentEntity> {
}
