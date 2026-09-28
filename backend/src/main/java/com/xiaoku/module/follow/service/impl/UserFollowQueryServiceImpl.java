package com.xiaoku.module.follow.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.follow.converter.FollowConverter;
import com.xiaoku.module.follow.entity.UserFollowEntity;
import com.xiaoku.module.follow.mapper.UserFollowMapper;
import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.follow.vo.FollowUserVO;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserFollowQueryServiceImpl implements UserFollowQueryService {

    private final UserFollowMapper userFollowMapper;
    private final UserQueryService userQueryService;

    @Override
    public boolean isFollowing(Long userId, Long targetId) {
        if (userId == null || targetId == null) {
            return false;
        }
        return userFollowMapper.selectCount(Wrappers.<UserFollowEntity>lambdaQuery()
                .eq(UserFollowEntity::getUserId, userId)
                .eq(UserFollowEntity::getFollowId, targetId)) > 0;
    }

    @Override
    public Set<Long> batchFollowingIds(Long userId, Collection<Long> targetIds) {
        if (userId == null || targetIds == null || targetIds.isEmpty()) {
            return Collections.emptySet();
        }
        List<Long> distinct = targetIds.stream().filter(Objects::nonNull).distinct().toList();
        if (distinct.isEmpty()) {
            return Collections.emptySet();
        }
        return userFollowMapper.selectList(Wrappers.<UserFollowEntity>lambdaQuery()
                        .eq(UserFollowEntity::getUserId, userId)
                        .in(UserFollowEntity::getFollowId, new HashSet<>(distinct)))
                .stream()
                .map(UserFollowEntity::getFollowId)
                .collect(Collectors.toSet());
    }

    @Override
    public PageVO<FollowUserVO> listFollowings(Long targetUserId, Long viewerId, int page, int size) {
        requireUserExists(targetUserId);
        // followings：从 user_id = target 的关系行，另一头是 follow_id
        Page<UserFollowEntity> result = queryPage(EntityColumn.USER_ID, targetUserId, page, size);
        return toVO(result, UserFollowQueryServiceImpl::followIdOf, viewerId);
    }

    @Override
    public PageVO<FollowUserVO> listFans(Long targetUserId, Long viewerId, int page, int size) {
        requireUserExists(targetUserId);
        // fans：从 follow_id = target 的关系行，另一头是 user_id
        Page<UserFollowEntity> result = queryPage(EntityColumn.FOLLOW_ID, targetUserId, page, size);
        return toVO(result, UserFollowQueryServiceImpl::userIdOf, viewerId);
    }

    /**
     * 关系行 -> 用户行：一次 IN 捞用户，一次 IN 算 followed，N+1 变成 2 次查询。
     *
     * <p>listFollowings 和 listFans 只是「关系行的哪一边是目标用户」不同
     * （另一边才是要展示的人），所以把取「另一边 id」的逻辑抽成
     * {@code idExtractor} 传进来，两条查询共用同一段组装代码。
     *
     * <p>已被逻辑删除的用户不会进 findUserVOMap，这里直接跳过（作者注销了）。
     */
    private PageVO<FollowUserVO> toVO(Page<UserFollowEntity> page,
                                      Function<UserFollowEntity, Long> idExtractor,
                                      Long viewerId) {
        List<Long> targetIds = page.getRecords().stream().map(idExtractor).toList();
        if (page.getRecords().isEmpty()) {
            return PageVO.of(List.of(), page.getTotal(), Math.toIntExact(page.getCurrent()),
                    Math.toIntExact(page.getSize()));
        }
        Map<Long, UserVO> users = userQueryService.findUserVOMap(targetIds);
        Set<Long> following = batchFollowingIds(viewerId, targetIds);

        List<FollowUserVO> voList = new ArrayList<>();
        for (UserFollowEntity row : page.getRecords()) {
            Long targetId = idExtractor.apply(row);
            UserVO user = users.get(targetId);
            if (user == null) {
                continue;
            }
            voList.add(FollowConverter.toVO(user, following.contains(targetId)));
        }
        return PageVO.of(voList, page.getTotal(), Math.toIntExact(page.getCurrent()),
                    Math.toIntExact(page.getSize()));
    }

    private Page<UserFollowEntity> queryPage(EntityColumn column, Long targetUserId,
                                             int page, int size) {
        Page<UserFollowEntity> pageInfo = new Page<>(page, size);
        var query = Wrappers.<UserFollowEntity>lambdaQuery()
                .orderByDesc(UserFollowEntity::getCreateTime)
                .orderByDesc(UserFollowEntity::getId);
        if (column == EntityColumn.USER_ID) {
            query.eq(UserFollowEntity::getUserId, targetUserId);
        } else {
            query.eq(UserFollowEntity::getFollowId, targetUserId);
        }
        return userFollowMapper.selectPage(pageInfo, query);
    }

    private static Long followIdOf(UserFollowEntity row) {
        return row.getFollowId();
    }

    private static Long userIdOf(UserFollowEntity row) {
        return row.getUserId();
    }

    /** 这次列表要让「关系的哪一边 == 目标用户」 */
    private enum EntityColumn {USER_ID, FOLLOW_ID}

    @Override
    public FollowUserVO getFollowStatus(Long targetUserId, Long viewerId) {
        requireUserExists(targetUserId);
        UserVO target = userQueryService.findUserVO(targetUserId);
        boolean followed = isFollowing(viewerId, targetUserId);
        return FollowConverter.toVO(target, followed);
    }

    private void requireUserExists(Long userId) {
        if (userQueryService.findUserVO(userId) == null) {
            throw new BizException(ErrorCodeEnum.USER_NOT_FOUND);
        }
    }
}