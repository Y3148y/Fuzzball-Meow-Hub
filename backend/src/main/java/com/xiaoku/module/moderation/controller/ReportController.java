package com.xiaoku.module.moderation.controller;

import com.xiaoku.common.annotation.RateLimit;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.moderation.dto.ReportCreateDTO;
import com.xiaoku.module.moderation.enums.ReportReason;
import com.xiaoku.module.moderation.service.ReportService;
import com.xiaoku.module.user.service.UserBlockService;
import com.xiaoku.module.user.vo.BlockedUserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 举报与黑名单
 *
 * <p>两个动作放一个 controller：它们是同一个问题的两面 ——
 * 「我不想看到它」（私人屏蔽）与「我认为它不该存在」（公共治理）。
 * 放一起是因为前端举报弹窗里通常就带一个「同时拉黑」的选项。
 */
@Tag(name = "举报与黑名单")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ReportController {

    private final ReportService reportService;
    private final UserBlockService userBlockService;

    /* ==================== 举报 ==================== */

    /**
     * 举报原因列表：前端举报弹窗据此渲染成可点的一排选项。
     *
     * <p>放接口而不是写死在前端：运营随时能加/改分类（比如「诱导互动」），
     * 而前端跟着发版才能改。固定枚举 + 静态列表正是为了这个。
     */
    @Operation(summary = "举报原因列表", description = "固定枚举，前端据此渲染举报弹窗的选项")
    @GetMapping("/report/reasons")
    public Result<List<ReasonVO>> reasons() {
        List<ReasonVO> list = java.util.Arrays.stream(ReportReason.values())
                .map(r -> new ReasonVO(r.code(), r.text()))
                .toList();
        return Result.success(list);
    }

    @Operation(summary = "举报", description = "同一对象只能举报一次；举报只是记录，不自动处置")
    @RateLimit(count = 20, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "举报太频繁了，请稍后再试")
    @PostMapping("/report")
    public Result<Long> report(@RequestBody @Valid ReportCreateDTO dto) {
        Long id = reportService.report(UserContextHolder.requireUserId(), dto);
        return Result.success(id);
    }

    /* ==================== 黑名单 ==================== */

    @Operation(summary = "拉黑", description = "只影响我的视野，不通知对方；重复拉黑返回 80005")
    @PostMapping("/user/block/{targetId}")
    public Result<Void> block(@Parameter(description = "被拉黑的用户ID") @PathVariable Long targetId) {
        userBlockService.block(UserContextHolder.requireUserId(), targetId);
        return Result.success();
    }

    @Operation(summary = "取消拉黑", description = "没拉黑过返回 80006（不静默成功，否则前端会把按钮状态改掉）")
    @DeleteMapping("/user/block/{targetId}")
    public Result<Void> unblock(@Parameter(description = "被拉黑的用户ID") @PathVariable Long targetId) {
        userBlockService.unblock(UserContextHolder.requireUserId(), targetId);
        return Result.success();
    }

    @Operation(summary = "我的黑名单")
    @GetMapping("/user/block/list")
    public Result<PageVO<BlockedUserVO>> myBlocks(
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(userBlockService.pageBlocked(UserContextHolder.requireUserId(),
                (int) Math.max(page, 1L), (int) Math.min(Math.max(size, 1L), 100L)));
    }

    /** 举报原因项 */
    public record ReasonVO(int code, String text) {
    }
}