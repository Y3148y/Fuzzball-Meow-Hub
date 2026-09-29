package com.xiaoku.module.search.controller;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.search.service.SearchService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 搜索模块接口。
 *
 * <p><b>为什么搜索也要登录：</b>结果卡片带 {@code authorFollowed} 视图态，
 * 并且沿用项目「默认全部需要登录、白名单只是收紧的口子」原则
 * （见 {@code MvcConfig}）。客户端搜索无需改白名单，直接复用鉴权。
 */
@Tag(name = "06-搜索模块", description = "笔记全文搜索、索引重建（对账兜底）")
@RestController
@RequestMapping("/api/search")
@RequiredArgsConstructor
public class SearchController {

    private final SearchService searchService;

    @Operation(summary = "搜索笔记",
            description = "对标题（权重2）与正文做 multi_match 全文搜索，只返回已发布笔记，按相关性与时间倒序分页")
    @GetMapping("/note")
    public Result<PageVO<NoteListItemVO>> search(
            @Parameter(description = "搜索关键词，不能为空") @RequestParam String keyword,
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        int safeSize = (int) Math.min(Math.max(size, 1L), 100L);
        int safePage = (int) Math.max(page, 1L);
        return Result.success(searchService.searchNote(keyword, safePage, safeSize));
    }

    @Operation(summary = "重建笔记索引",
            description = "删旧索引 + 按 mapping 重建 + MySQL 全量回灌已发布笔记。事件管道丢了数据、索引被误删时用它拉回")
    @PostMapping("/reindex")
    public Result<Map<String, Integer>> reindex() {
        return Result.success(Map.of("indexed", searchService.rebuildNoteIndex()));
    }
}