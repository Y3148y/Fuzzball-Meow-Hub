package com.xiaoku.module.follow.converter;

import com.xiaoku.module.follow.vo.FollowUserVO;
import com.xiaoku.module.user.vo.UserVO;

/**
 * UserVO -> FollowUserVO，把「当前浏览者是否已关注」的视图态叠上去。
 *
 * <p>拆 null 的兜底：用户可能刚被逻辑删除、而关注关系行还残留，
 * 此时 findUserVOMap 里没有 TA，列表层会先过滤，正常到不了这里。
 */
public final class FollowConverter {

    private FollowConverter() {
    }

    public static FollowUserVO toVO(UserVO user, boolean followed) {
        if (user == null) {
            return null;
        }
        return FollowUserVO.builder()
                .id(user.getId())
                .username(user.getUsername())
                .nickname(user.getNickname())
                .avatar(user.getAvatar())
                .bio(user.getBio())
                .gender(user.getGender())
                .followCount(user.getFollowCount())
                .fansCount(user.getFansCount())
                .likeReceivedCount(user.getLikeReceivedCount())
                .createTime(user.getCreateTime())
                .followed(followed)
                .build();
    }
}