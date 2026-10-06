package com.xiaoku.module.notification.controller;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.notification.service.NotificationService;
import com.xiaoku.module.notification.vo.NotificationVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * 通知接口
 *
 * <p>社交闭环里最短的那条链：别人对我做了事，我得知道。全站默认需要登录。
 */
@Tag(name = "08-通知", description = "点赞/评论/关注通知")
@RestController
@RequestMapping("/api/notification")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;

    @Operation(summary = "通知列表",
            description = "当前登录用户收到的通知，未读优先再按时间倒序")
    @GetMapping("/list")
    public Result<PageVO<NotificationVO>> list(
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size,
            @Parameter(description = "只看未读") @RequestParam(defaultValue = "false") boolean onlyUnread) {
        int safeSize = (int) Math.min(Math.max(size, 1L), 100L);
        int safePage = (int) Math.max(page, 1L);
        return Result.success(notificationService.pageMyNotifications(safePage, safeSize, onlyUnread));
    }

    @Operation(summary = "未读数", description = "铃铛角标用的未读条数")
    @GetMapping("/unread-count")
    public Result<Integer> unreadCount() {
        return Result.success(notificationService.unreadCount());
    }

    @Operation(summary = "单条已读", description = "本来就读过或不归当前用户都返回成功（幂等）")
    @PostMapping("/{id}/read")
    public Result<Boolean> read(@PathVariable Long id) {
        return Result.success(notificationService.markRead(id));
    }

    @Operation(summary = "全部已读", description = "返回受影响条数")
    @PostMapping("/read-all")
    public Result<Integer> readAll() {
        return Result.success(notificationService.markAllRead());
    }
}