package com.xiaoku.module.search.controller;

import com.xiaoku.common.annotation.RateLimit;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.note.vo.NoteListItemVO;
import com.xiaoku.module.search.service.SearchService;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserPickVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
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
    private final UserQueryService userQueryService;

    @Operation(summary = "搜索笔记",
            description = "对标题（权重2）与正文做 multi_match 全文搜索，只返回已发布笔记，按相关性与时间倒序分页")
    // 搜索是最容易被爬的读接口（不需要登录态也能猜到 URL），阈值给到 60/分钟
    @RateLimit(count = 60, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "搜索太频繁啦，1 分钟内最多 60 次")
    @GetMapping("/note")
    public Result<PageVO<NoteListItemVO>> search(
            @Parameter(description = "搜索关键词，不能为空") @RequestParam String keyword,
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        int safeSize = (int) Math.min(Math.max(size, 1L), 100L);
        int safePage = (int) Math.max(page, 1L);
        return Result.success(searchService.searchNote(keyword, safePage, safeSize));
    }

    @Operation(summary = "搜索可被 @ 提及的用户",
            description = "「@ 提及」候选列表。昵称与用户名**都匹配**（界面上显示昵称，@ 之后插入用户名，两者都得能搜到）。"
                    + "自动排除自己、已拉黑（双向）、已注销与已禁用账号")
    // 阈值比笔记搜索低：@ 选择器是**每敲一个字符就发一次**（前端做了 200ms 防抖，
    // 但连着打字仍然能打满），而笔记搜索是一次回车才发一次。
    @RateLimit(count = 40, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "找人太频繁啦，1 分钟内最多 40 次")
    @GetMapping("/user")
    public Result<List<UserPickVO>> searchUser(
            @Parameter(description = "关键词，匹配昵称或用户名") @RequestParam String keyword,
            @Parameter(description = "最多返回几条") @RequestParam(defaultValue = "10") long limit) {
        // 空关键词直接返回空列表而不是报错：@ 后面刚敲出 @ 时前端就该拿到空列表
        int safeLimit = (int) Math.min(Math.max(limit, 1L), 20L);
        return Result.success(userQueryService.searchForMention(keyword, currentUserId(), safeLimit));
    }

    @Operation(summary = "重建笔记索引",
            description = "删旧索引 + 按 mapping 重建 + MySQL 全量回灌已发布笔记。事件管道丢了数据、索引被误删时用它拉回")
    // 重建是「删索引 + 全量回灌」的重操作，绝不能被随手连点：
    // 阈值 3/分钟，且按用户限流而不是按 IP，多个人一起点也拦得住同一个账号的连击。
    @RateLimit(count = 3, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "索引重建太频繁啦，1 分钟内最多 3 次")
    @PostMapping("/reindex")
    public Result<Map<String, Integer>> reindex() {
        return Result.success(Map.of("indexed", searchService.rebuildNoteIndex()));
    }

    /** 未登录返回 null —— 搜索本来就要求登录，这里只是不让 NPE 冒出来 */
    private static Long currentUserId() {
        var login = UserContextHolder.get();
        return login == null ? null : login.getUserId();
    }
}