package com.xiaoku.module.message.controller;

import com.xiaoku.common.annotation.Idempotent;
import com.xiaoku.common.annotation.RateLimit;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.message.dto.MessageSendDTO;
import com.xiaoku.module.message.service.MessageService;
import com.xiaoku.module.message.vo.MessageSessionVO;
import com.xiaoku.module.message.vo.MessageVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 私信接口
 *
 * <p>P22 的投递方式是<b>轮询</b>而不是 WebSocket：前端每 15s 拉一次
 * {@link #unreadCount}。理由是零新依赖、可上线、能验收，而消息最多晚 15s 出现 ——
 * 小红书客户端本来就是长连接，网页版用轮询是常规做法。
 * 接口层不需要为这个选择做任何让步，将来接 WebSocket 只改投递这一层。
 */
@Tag(name = "11-私信", description = "一对一私信：会话 / 消息 / 未读")
@RestController
@RequestMapping("/api/message")
@RequiredArgsConstructor
public class MessageController {

    private final MessageService messageService;

    @Operation(summary = "发送私信",
            description = "对方拉黑了我时返回 40003；不能给自己发（40002）")
    @PostMapping("/send")
    @Idempotent
    // 60/min/USER 比评论（10/min）宽：私信是「人跟人说话」，一次连发多条
    // 是正常用法而不是刷屏。防的是脚本批量骚扰，不是正常交互。
    @RateLimit(count = 60, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "发得太快了，稍等一下再试")
    public Result<MessageVO> send(@Valid @RequestBody MessageSendDTO dto) {
        return Result.success(messageService.send(dto));
    }

    @Operation(summary = "聊天记录",
            description = "按时间正序返回（最早→最新），翻页时取最新的 N 条再翻正")
    @GetMapping("/history")
    public Result<PageVO<MessageVO>> history(
            @Parameter(description = "对方 userId") @RequestParam Long withUserId,
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        int safeSize = (int) Math.min(Math.max(size, 1L), 100L);
        int safePage = (int) Math.max(page, 1L);
        return Result.success(messageService.history(withUserId, safePage, safeSize));
    }

    @Operation(summary = "会话列表", description = "按最后一条消息倒序，取最近 50 条")
    @GetMapping("/session/list")
    public Result<List<MessageSessionVO>> sessions() {
        return Result.success(messageService.listSessions());
    }

    @Operation(summary = "总未读数", description = "会话页角标用的未读消息条数")
    @GetMapping("/unread-count")
    public Result<Integer> unreadCount() {
        return Result.success(messageService.unreadCount());
    }

    @Operation(summary = "会话全部已读", description = "返回受影响条数；本来就是全已读时返回 0")
    @PostMapping("/read-all")
    public Result<Integer> readAll(
            @Parameter(description = "对方 userId") @RequestParam Long withUserId) {
        return Result.success(messageService.readAll(withUserId));
    }
}