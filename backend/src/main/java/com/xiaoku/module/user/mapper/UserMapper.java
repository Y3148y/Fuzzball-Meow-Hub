package com.xiaoku.module.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.user.entity.UserEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

/**
 * 用户 Mapper。
 *
 * <p>本项目不写 XML，只用 BaseMapper 提供的方法 + LambdaQueryWrapper。
 * 理由：校招面试官更关心「复杂查询怎么写、索引怎么用」，
 * 而这些用 QueryWrapper 已经能覆盖；真到了多表 Join、动态 SQL 的场景再引入 XML。
 * 后续 P7 搜索同步会用到自定义 SQL，那时再补一个 XML 演示两种写法。
 */
@Mapper
public interface UserMapper extends BaseMapper<UserEntity> {

    /**
     * 关注数 ±1。
     *
     * <p>同 NoteMapper 的理由：原子 SQL，不先查后写，避免并发丢计数。
     * {@code GREATEST(0, ...)} 兜底防止并发下把计数压成负数。
     */
    @Update("UPDATE `user` SET follow_count = GREATEST(0, follow_count + #{delta}) WHERE id = #{userId}")
    int updateFollowCount(@Param("userId") Long userId, @Param("delta") int delta);

    /** 粉丝数 ±1，理由同上 */
    @Update("UPDATE `user` SET fans_count = GREATEST(0, fans_count + #{delta}) WHERE id = #{userId}")
    int updateFansCount(@Param("userId") Long userId, @Param("delta") int delta);
}
