package com.xiaoku.module.user.converter;

import com.xiaoku.module.user.entity.UserEntity;
import com.xiaoku.module.user.vo.UserVO;

/**
 * Entity -> VO 转换。
 *
 * <p>为什么不写成 {@code UserEntity.toVO()} 或 MapStruct：
 * <ul>
 *     <li>写成 Entity 的方法会让实体依赖 VO 包，方向反了；</li>
 *     <li>抽成独立的 converter，Entity / VO 两边都不认识对方，依赖方向清晰；</li>
 *     <li>字段变多时这里的映射是唯一需要改的地方，IDE 能全文搜到。</li>
 * </ul>
 * 项目当前只有 10 来个字段，手写比引入 MapStruct 更直观；
 * 字段上百后再上 MapStruct / MapStructPlus 才划算。
 */
public final class UserConverter {

    private UserConverter() {
    }

    public static UserVO toVO(UserEntity user) {
        if (user == null) {
            return null;
        }
        return UserVO.builder()
                .id(user.getId())
                .username(user.getUsername())
                .nickname(user.getNickname())
                .avatar(user.getAvatar())
                .bio(user.getBio())
                .gender(user.getGender())
                .followCount(user.getFollowCount())
                .fansCount(user.getFansCount())
                .likeReceivedCount(user.getLikeReceivedCount())
                .role(user.getRole())
                .createTime(user.getCreateTime())
                .build();
    }
}
