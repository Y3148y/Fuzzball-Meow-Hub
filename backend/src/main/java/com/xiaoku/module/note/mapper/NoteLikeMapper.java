package com.xiaoku.module.note.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.note.entity.NoteLikeEntity;
import org.apache.ibatis.annotations.Mapper;

/**
 * 点赞关系。P3 只需要它回答「当前用户是否已点赞」，
 * 真正的点赞/取消点赞在 P5。
 */
@Mapper
public interface NoteLikeMapper extends BaseMapper<NoteLikeEntity> {
}
