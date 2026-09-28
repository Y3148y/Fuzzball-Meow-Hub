package com.xiaoku.module.follow.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.module.follow.converter.FollowConverter;
import com.xiaoku.module.follow.entity.UserFollowEntity;
import com.xiaoku.module.follow.mapper.UserFollowMapper;
import com.xiaoku.module.follow.service.UserFollowService;
import com.xiaoku.module.follow.vo.FollowUserVO;
import com.xiaoku.module.user.mapper.UserMapper;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserFollowServiceImpl implements UserFollowService {

    private final UserFollowMapper userFollowMapper;
    private final UserMapper userMapper;
    private final UserQueryService userQueryService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public FollowUserVO follow(Long targetId) {
        Long userId = UserContextHolder.requireUserId();
        if (userId.equals(targetId)) {
            throw new BizException(ErrorCodeEnum.CANNOT_FOLLOW_SELF);
        }

        // 目标必须是真实存在、未逻辑删除的用户，否则会留下指向虚空的关注关系
        if (userQueryService.findUserVO(targetId) == null) {
            throw new BizException(ErrorCodeEnum.USER_NOT_FOUND);
        }

        UserFollowEntity follow = new UserFollowEntity();
        follow.setUserId(userId);
        follow.setFollowId(targetId);
        follow.setStatus(1);
        try {
            userFollowMapper.insert(follow);
        } catch (DuplicateKeyException e) {
            // 唯一索引当裁判，和 P5 点赞/收藏同一套并发语义
            throw new BizException(ErrorCodeEnum.ALREADY_FOLLOWED);
        }

        // 计数对「关注方 / 被关注方」都做原子 ±1，MySQL 行锁保证并发不丢
        userMapper.updateFollowCount(userId, 1);
        userMapper.updateFansCount(targetId, 1);

        // 用户的关注/粉丝计数进了 Redis 缓存，两边都清，否则自己或对方看到的数字是旧的
        userQueryService.evictUserVO(userId);
        userQueryService.evictUserVO(targetId);

        log.info("关注成功 userId={} targetId={}", userId, targetId);
        return targetVO(targetId, true);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public FollowUserVO unfollow(Long targetId) {
        Long userId = UserContextHolder.requireUserId();
        if (userId.equals(targetId)) {
            throw new BizException(ErrorCodeEnum.CANNOT_FOLLOW_SELF);
        }

        int deleted = userFollowMapper.delete(Wrappers.<UserFollowEntity>lambdaQuery()
                .eq(UserFollowEntity::getUserId, userId)
                .eq(UserFollowEntity::getFollowId, targetId));
        if (deleted == 0) {
            // 静默成功会让前端以为「确实取关了」，而计数其实没动
            throw new BizException(ErrorCodeEnum.NOT_FOLLOWED_YET);
        }

        userMapper.updateFollowCount(userId, -1);
        userMapper.updateFansCount(targetId, -1);

        userQueryService.evictUserVO(userId);
        userQueryService.evictUserVO(targetId);

        log.info("取关成功 userId={} targetId={}", userId, targetId);
        return targetVO(targetId, false);
    }

    /**
     * 操作完成后回读被关注者的最新信息给前端刷新按钮态。
     *
     * <p>极端场景：目标用户刚被逻辑删除，findUserVO 回 null，
     * 就只回一个带 id 的壳，不让整个请求 500。
     */
    private FollowUserVO targetVO(Long targetId, boolean followed) {
        UserVO target = userQueryService.findUserVO(targetId);
        if (target == null) {
            return FollowUserVO.builder().id(targetId).followed(followed).build();
        }
        return FollowConverter.toVO(target, followed);
    }
}