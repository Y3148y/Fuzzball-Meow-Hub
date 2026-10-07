package com.xiaoku.module.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.user.entity.UserBlockEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Set;

@Mapper
public interface UserBlockMapper extends BaseMapper<UserBlockEntity> {

    @Select("SELECT blocked_id FROM user_block WHERE user_id = #{userId}")
    List<Long> selectBlockedIds(@Param("userId") Long userId);

    /**
     * 我拉黑的人 + 拉黑我的人
     *
     * <p><b>两个方向都要</b>：拉黑是「我看不见 TA」，但对方把 TA 拉黑我之后，
     * 我也不该继续看见 TA 的内容 —— 否则「拉黑」就成了单向可见，
     * 和现实里的直觉相反。
     *
     * <p>一次查询而不是两次：首页两个流都要用这个集合，
     * 分两次查就是两次网络往返，而它们几乎总是同时被调用。
     */
    @Select("""
            SELECT blocked_id FROM user_block WHERE user_id = #{userId}
            UNION
            SELECT user_id FROM user_block WHERE blocked_id = #{userId}
            """)
    List<Long> selectHiddenUserIds(@Param("userId") Long userId);
}