package com.xiaoku.module.comment.controller;

import com.xiaoku.common.annotation.Idempotent;
import com.xiaoku.common.annotation.RateLimit;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.comment.dto.CommentCreateDTO;
import com.xiaoku.module.comment.service.CommentQueryService;
import com.xiaoku.module.comment.service.CommentService;
import com.xiaoku.module.comment.vo.CommentVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/** 评论模块接口 */
@Tag(name = "03-评论模块", description = "评论列表、发表、删除")
@RestController
@RequestMapping("/api/comment")
@RequiredArgsConstructor
public class CommentController {

    private final CommentService commentService;
    private final CommentQueryService commentQueryService;

    @Operation(summary = "评论列表",
            description = "按笔记分页返回一级评论，每条自带前 3 条子回复与子回复总数 replyTotal")
    @GetMapping("/list")
    public Result<PageVO<CommentVO>> list(
            @Parameter(description = "笔记ID", required = true) @RequestParam Long noteId,
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        // size 兜底：分页插件的 setMaxLimit(500) 拦的是 SQL 层，
        // 这里在入口就收窄，避免参数校验和插件行为两套标准。
        //
        // 先用 long 夹到 [1, 100] 再强转：强转本身是安全的，因为夹完之后
        // 值一定落在 int 范围内。写成 Math.toIntExact(...) 反而多余。
        // 顺带挡掉 "?size=99999999999" 这类会直接打到 SQL 层的问题
        int safeSize = (int) Math.min(Math.max(size, 1L), 100L);
        int safePage = (int) Math.max(page, 1L);
        return Result.success(commentQueryService.listByNote(noteId, safePage, safeSize));
    }

    @Operation(summary = "发表评论",
            description = "带 parentId 即为回复。不允许评论自己的笔记（30007）")
    // 评论是无成本高收益的刷量入口（注册即可发），阈值给到 10/分钟
    @RateLimit(count = 10, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "评论太频繁啦，1 分钟内最多 10 条")
    // 评论重复 = 同一条评论出现两遍，是最容易被用户直接指出来的功能缺陷
    @Idempotent
    @PostMapping
    public Result<CommentVO> create(@RequestBody @Valid CommentCreateDTO dto) {
        return Result.success(commentService.create(dto));
    }

    @Operation(summary = "删除评论", description = "仅作者本人可删，删根评论会连带其子回复")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@Parameter(description = "评论ID") @PathVariable Long id) {
        commentService.delete(id);
        return Result.success();
    }

    // ------------------------------------------------------------------
    // 评论点赞
    //
    // 与笔记点赞同样的 PUT/DELETE 幂等语义。刻意不挂限流/幂等注解：
    // 点赞是无副作用的轻操作（不会产生两条数据），刷量成本低于评论/发布，
    // 和笔记侧 like/unlike 的取舍保持一致。
    // ------------------------------------------------------------------

    @Operation(summary = "点赞评论", description = "重复点赞返回 30001；已下架笔记的评论不可再点赞")
    @PutMapping("/{id}/like")
    public Result<CommentVO> like(@Parameter(description = "评论ID") @PathVariable Long id) {
        return Result.success(commentService.like(id));
    }

    @Operation(summary = "取消点赞评论", description = "未点赞时取消失败返回 30002")
    @DeleteMapping("/{id}/like")
    public Result<CommentVO> unlike(@Parameter(description = "评论ID") @PathVariable Long id) {
        return Result.success(commentService.unlike(id));
    }
}
