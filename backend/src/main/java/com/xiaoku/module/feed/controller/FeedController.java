package com.xiaoku.module.feed.controller;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.feed.service.FeedService;
import com.xiaoku.module.note.vo.NoteListItemVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/** 信息流接口。 */
@Tag(name = "05-信息流", description = "关注流")
@RestController
@RequestMapping("/api/feed")
@RequiredArgsConstructor
public class FeedController {

    private final FeedService feedService;

    @Operation(summary = "关注流",
            description = "当前用户关注的作者们发布的笔记，按发布时间倒序分页")
    @GetMapping("/follow")
    public Result<PageVO<NoteListItemVO>> followFeed(
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        int safeSize = (int) Math.min(Math.max(size, 1L), 100L);
        int safePage = (int) Math.max(page, 1L);
        return Result.success(feedService.followFeed(safePage, safeSize));
    }
}