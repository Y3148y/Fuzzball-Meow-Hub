package com.xiaoku.module.follow.service;

import com.xiaoku.module.follow.vo.FollowUserVO;

/**
 * 关注关系的<b>写</b>侧：关注 / 取关。
 *
 * <p>语义是物理删（见 {@link com.xiaoku.module.follow.entity.UserFollowEntity} 注释）：
 * 关注 insert 撞唯一索引 {@code uk_user_follow} → 40001 <b>已经关注过该用户了</b>；
 * 取关 delete 删 0 行 → 40002 <b>尚未关注，无法取关</b>；
 * 关注自己 → 40003 <b>不能关注自己</b>。三个错误码在这个实现下都有真实触发路径。
 */
public interface UserFollowService {

    /**
     * 关注某用户。
     *
     * @param targetId 被关注者ID
     * @return 关注完成后被关注者的可展示信息（含 followed=true）
     */
    FollowUserVO follow(Long targetId);

    /**
     * 取关某用户。
     *
     * @param targetId 被取关者ID
     * @return 取关完成后被关注者的可展示信息（含 followed=false）
     */
    FollowUserVO unfollow(Long targetId);
}