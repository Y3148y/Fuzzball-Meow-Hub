package com.xiaoku.module.user.service.impl;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.user.entity.UserBlockEntity;
import com.xiaoku.module.user.entity.UserEntity;
import com.xiaoku.module.user.vo.UserVO;
import com.xiaoku.module.user.mapper.UserBlockMapper;
import com.xiaoku.module.user.mapper.UserMapper;
import com.xiaoku.module.user.service.UserBlockService;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.BlockedUserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 黑名单实现
 *
 * <p><b>拉黑只影响「我」的视野</b>，且**双向生效**：对方拉黑我之后，
 * 我也不该继续看见 TA 的内容。做成单向的话，「拉黑」就成了一个只能自己
 * 藏起来但藏不住别人的按钮，语义与现实里的直觉相反。
 *
 * <p><b>刻意不在拉黑时取关</b>：关注是「我订阅了 TA」，拉黑是「我不想看到 TA」。
 * 两者独立 —— 取消关注是关系解除，拉黑是过滤开关。真实产品里也基本都这样，
 * 而且这样「取消拉黑」之后还能看到对方的历史关注内容，用户不会觉得行为被偷走了。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserBlockServiceImpl implements UserBlockService {

    private final UserBlockMapper userBlockMapper;
    private final UserMapper userMapper;
    private final UserQueryService userQueryService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void block(Long userId, Long targetId) {
        if (userId.equals(targetId)) {
            throw new BizException(ErrorCodeEnum.CANNOT_BLOCK_SELF);
        }
        UserEntity target = userMapper.selectById(targetId);
        if (target == null) {
            throw new BizException(ErrorCodeEnum.USER_NOT_FOUND);
        }
        boolean exists = userBlockMapper.exists(Wrappers.<UserBlockEntity>lambdaQuery()
                .eq(UserBlockEntity::getUserId, userId)
                .eq(UserBlockEntity::getBlockedId, targetId));
        if (exists) {
            throw new BizException(ErrorCodeEnum.ALREADY_BLOCKED);
        }
        UserBlockEntity row = new UserBlockEntity();
        row.setId(IdWorker.getId());
        row.setUserId(userId);
        row.setBlockedId(targetId);
        try {
            userBlockMapper.insert(row);
        } catch (org.springframework.dao.DuplicateKeyException e) {
            // 并发下重复拉黑：撞 uk_block_once，翻译成业务错误
            throw new BizException(ErrorCodeEnum.ALREADY_BLOCKED);
        }
        log.info("已拉黑 userId={} targetId={}", userId, targetId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void unblock(Long userId, Long targetId) {
        int deleted = userBlockMapper.delete(Wrappers.<UserBlockEntity>lambdaQuery()
                .eq(UserBlockEntity::getUserId, userId)
                .eq(UserBlockEntity::getBlockedId, targetId));
        if (deleted == 0) {
            // 「没拉黑却取消」必须报错：静默成功会让前端把按钮状态改掉，
            // 而实际关系没变，刷新一下又回来了
            throw new BizException(ErrorCodeEnum.NOT_BLOCKED_YET);
        }
        log.info("已取消拉黑 userId={} targetId={}", userId, targetId);
    }

    @Override
    public PageVO<BlockedUserVO> pageBlocked(Long userId, int page, int size) {
        var p = userBlockMapper.selectPage(new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>(page, size),
                Wrappers.<UserBlockEntity>lambdaQuery()
                        .eq(UserBlockEntity::getUserId, userId)
                        .orderByDesc(UserBlockEntity::getCreateTime)
                        .orderByDesc(UserBlockEntity::getId));
        if (p.getRecords().isEmpty()) {
            return PageVO.of(List.of(), p.getTotal(), page, size);
        }
        List<Long> ids = p.getRecords().stream().map(UserBlockEntity::getBlockedId).toList();
        Map<Long, UserVO> users = userQueryService.findUserVOMap(ids);
        List<BlockedUserVO> list = p.getRecords().stream()
                .map(row -> {
                    UserVO u = users.get(row.getBlockedId());
                    // 用户被注销时 findUserVOMap 会漏掉，跳过而不是给一行空卡片
                    if (u == null) {
                        return null;
                    }
                    return BlockedUserVO.builder()
                            .id(u.getId())
                            .username(u.getUsername())
                            .nickname(u.getNickname())
                            .avatar(u.getAvatar())
                            .createTime(row.getCreateTime())
                            .build();
                })
                .filter(java.util.Objects::nonNull)
                .toList();
        return PageVO.of(list, p.getTotal(), page, size);
    }

    @Override
    public Set<Long> hiddenUserIds(Long userId) {
        if (userId == null) {
            return Set.of();
        }
        List<Long> hidden = userBlockMapper.selectHiddenUserIds(userId);
        return hidden.isEmpty() ? Collections.emptySet() : new HashSet<>(hidden);
    }

    @Override
    public boolean isBlocked(Long userId, Long targetId) {
        if (userId == null || targetId == null) {
            return false;
        }
        return userBlockMapper.exists(Wrappers.<UserBlockEntity>lambdaQuery()
                .eq(UserBlockEntity::getUserId, userId)
                .eq(UserBlockEntity::getBlockedId, targetId));
    }
}