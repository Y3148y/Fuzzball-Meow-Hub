package com.xiaoku.module.feed.controller;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.feed.service.FeedService;
import com.xiaoku.module.note.vo.ImmerseCardVO;
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
            description = "当前用户关注的作者发布的笔记，按发布时间倒序分页")
    @GetMapping("/follow")
    public Result<PageVO<NoteListItemVO>> followFeed(
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(feedService.followFeed(safePage(page), safeSize(size)));
    }

    /**
     * 发现流：全站已发布笔记（排除自己发的），排序 = 关注优先 → 互动量 → 最新补位
     *
     * <p>存在的理由：关注流对「一个新用户、一条关注都没有」永远是空的，冷启动无内容可看。
     * 前端首页做成两个 tab（关注 / 发现），这个接口喂第二个。
     */
    @Operation(summary = "发现流",
            description = "全站已发布笔记（不含自己发的），关注过的作者优先、其次互动量、最后按时间补位")
    @GetMapping("/discover")
    public Result<PageVO<NoteListItemVO>> discoverFeed(
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(feedService.discoverFeed(safePage(page), safeSize(size)));
    }

    /**
     * 沉浸流：给「一屏一张、上下滑」那个页面喂数据
     *
     * <p>排序与发现流**刻意一致**（见 FeedServiceImpl#immerseFeed 的注释）：
     * 首页看到的内容与滑到的内容必须对得上，否则「首页有但滑不到」极难归因。
     *
     * <p>size 上限放到 20（发现流是 100）：沉浸流一次渲染一整屏的卡片，
     * 一次拉 100 条会同时下载上百张图，移动网络下直接把首屏拖垮。
     */
    @Operation(summary = "沉浸流",
        description = "排序与发现流一致，但每条带全部图片与正文摘要，供一屏一张的上下滑页面使用")
    @GetMapping("/immerse")
    public Result<PageVO<ImmerseCardVO>> immerseFeed(
        @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
        @Parameter(description = "每页条数，上限 20") @RequestParam(defaultValue = "6") long size) {
        return Result.success(feedService.immerseFeed(safePage(page), (int) Math.min(Math.max(size, 1L), 20L)));
    }

    private static int safePage(long page) {
        return (int) Math.max(page, 1L);
    }

    private static int safeSize(long size) {
        return (int) Math.min(Math.max(size, 1L), 100L);
    }
}