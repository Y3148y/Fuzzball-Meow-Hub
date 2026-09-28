package com.xiaoku.module.follow.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.follow.entity.UserFollowEntity;
import org.apache.ibatis.annotations.Mapper;

/**
 * 关注关系 Mapper。
 *
 * <p>一套 BaseMapper + LambdaQueryWrapper 就够：
 * followings 是 {@code user_id = target}，fans 是 {@code follow_id = target}，
 * 两次标准查询 + 一次 IN 捞用户，不需要自定义 SQL（多表 JOIN 留给 feed 模块）。
 */
@Mapper
public interface UserFollowMapper extends BaseMapper<UserFollowEntity> {
}