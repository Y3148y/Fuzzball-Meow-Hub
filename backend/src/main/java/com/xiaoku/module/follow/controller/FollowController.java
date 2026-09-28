package com.xiaoku.module.follow.controller;

import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.follow.service.UserFollowService;
import com.xiaoku.module.follow.vo.FollowUserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/** 关注模块接口。 */
@Tag(name = "04-关注模块", description = "关注/取关、关注列表、粉丝列表")
@RestController
@RequestMapping("/api/follow")
@RequiredArgsConstructor
public class FollowController {

    private final UserFollowService userFollowService;
    private final UserFollowQueryService userFollowQueryService;

    @Operation(summary = "关注用户", description = "重复关注返回 40001，关注自己返回 40003")
    @PutMapping("/{userId}")
    public Result<FollowUserVO> follow(@Parameter(description = "被关注用户ID") @PathVariable Long userId) {
        return Result.success(userFollowService.follow(userId));
    }

    @Operation(summary = "取关用户", description = "未关注时取关返回 40002")
    @DeleteMapping("/{userId}")
    public Result<FollowUserVO> unfollow(@Parameter(description = "被取关用户ID") @PathVariable Long userId) {
        return Result.success(userFollowService.unfollow(userId));
    }

    @Operation(summary = "单个用户的关注状态",
            description = "用户信息 + 当前登录用户是否已关注 TA，作者主页卡片一次往返拿全")
    @GetMapping("/user/{userId}")
    public Result<FollowUserVO> user(
            @Parameter(description = "目标用户ID") @PathVariable Long userId) {
        return Result.success(userFollowQueryService.getFollowStatus(userId, currentUserId()));
    }

    @Operation(summary = "某用户的关注列表", description = "每行带当前登录用户是否已关注 TA")
    @GetMapping("/followings")
    public Result<PageVO<FollowUserVO>> followings(
            @Parameter(description = "目标用户ID", required = true) @RequestParam Long userId,
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(userFollowQueryService.listFollowings(userId, currentUserId(),
                clampPage(page), clampSize(size)));
    }

    @Operation(summary = "某用户的粉丝列表", description = "每行带当前登录用户是否已关注 TA")
    @GetMapping("/fans")
    public Result<PageVO<FollowUserVO>> fans(
            @Parameter(description = "目标用户ID", required = true) @RequestParam Long userId,
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(userFollowQueryService.listFans(userId, currentUserId(),
                clampPage(page), clampSize(size)));
    }

    /** 与评论模块同一套收窄逻辑：先把参数夹进安全区间再强转 int */
    private static int clampSize(long size) {
        return (int) Math.min(Math.max(size, 1L), 100L);
    }

    private static int clampPage(long page) {
        return (int) Math.max(page, 1L);
    }

    private static Long currentUserId() {
        var login = UserContextHolder.get();
        return login == null ? null : login.getUserId();
    }
}