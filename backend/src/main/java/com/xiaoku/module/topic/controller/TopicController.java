package com.xiaoku.module.topic.controller;

import com.xiaoku.common.annotation.RateLimit;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.topic.service.TopicQueryService;
import com.xiaoku.module.topic.vo.TopicListVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "话题")
@RestController
@RequestMapping("/api/topic")
@RequiredArgsConstructor
public class TopicController {

    private final TopicQueryService topicQueryService;

    @Operation(summary = "热门话题", description = "按已发布笔记数倒序；数量实时统计，不落库")
    @RateLimit(count = 60, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "话题列表请求过于频繁，请稍后再试")
    @GetMapping("/list")
    public Result<PageVO<TopicListVO>> hotTopics(
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(topicQueryService.pageHotTopics(safePage(page), safeSize(size)));
    }

    @Operation(summary = "某个话题下的笔记",
            description = "话题名可带或不带 #；话题不存在返回 70001（不静默返回空列表）")
    @RateLimit(count = 60, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "话题页请求过于频繁，请稍后再试")
    @GetMapping("/notes")
    public Result<PageVO<NoteListItemVO>> topicNotes(
            @Parameter(description = "话题名") @RequestParam String name,
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(topicQueryService.pageTopicNotes(name, safePage(page), safeSize(size)));
    }

    private static int safePage(long page) {
        return (int) Math.max(page, 1L);
    }

    private static int safeSize(long size) {
        return (int) Math.min(Math.max(size, 1L), 100L);
    }
}