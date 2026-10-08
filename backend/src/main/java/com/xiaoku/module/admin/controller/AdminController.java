package com.xiaoku.module.admin.controller;

import com.xiaoku.common.annotation.RateLimit;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.admin.dto.NoteStatusDTO;
import com.xiaoku.module.admin.dto.ReportHandleDTO;
import com.xiaoku.module.admin.dto.UserStatusDTO;
import com.xiaoku.module.admin.service.AdminService;
import com.xiaoku.module.admin.vo.AdminNoteItemVO;
import com.xiaoku.module.admin.vo.AdminReportVO;
import com.xiaoku.module.admin.vo.AdminUserItemVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 运营管理后台。
 *
 * <p>三个域（举报 / 用户 / 笔记）放一个 controller：它们共用同一套鉴权
 * （{@code AdminInterceptor} 按路径前缀拦截整个类），拆成三个类只会得到
 * 三份一模一样的注解和方法签名骨架。
 *
 * <p>⚠️ <b>权限不在这一层判</b>，而是靠路径前缀 {@code /api/admin/**} +
 * 拦截器。因此：<b>任何新加的管理接口都必须挂在这个前缀下</b>，
 * 挂到别处等于既没有鉴权也通过了测试 —— 它会返回正常的业务数据。
 */
@Tag(name = "运营管理后台")
@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminController {

    private final AdminService adminService;

    /* ==================== 举报处置 ==================== */

    @Operation(summary = "待处理举报数", description = "运营首页红点，不分页")
    @GetMapping("/report/pending-count")
    public Result<Long> pendingCount() {
        return Result.success(adminService.countPendingReports());
    }

    @Operation(summary = "举报列表",
            description = "status 不传=全部；0 待处理 1 已受理 2 已驳回。带被举报内容摘要与举报人")
    @GetMapping("/report/list")
    public Result<PageVO<AdminReportVO>> reports(
            @Parameter(description = "0 待处理 1 已受理 2 已驳回") @RequestParam(required = false) Integer status,
            @Parameter(description = "1 笔记 2 评论") @RequestParam(required = false) Integer targetType,
            @Parameter(description = "页码") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(adminService.pageReports(status, targetType,
                (int) Math.max(page, 1L), (int) Math.min(Math.max(size, 1L), 100L)));
    }

    @Operation(summary = "处置举报",
            description = "action: 1 驳回 2 下架笔记 3 删除笔记 4 禁用作者。已处置过的再处置返 90003")
    // 运营处置是低频人工动作，限流只是为了挡住「脚本批量点处置」的误用，
    // 数字比用户侧宽松得多（用户举报是 20/min）
    @RateLimit(count = 60, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "处置过于频繁，请稍后再试")
    @PostMapping("/report/{id}/handle")
    public Result<Void> handleReport(@PathVariable Long id, @RequestBody @Valid ReportHandleDTO dto) {
        adminService.handleReport(id, dto);
        return Result.success();
    }

    @Operation(summary = "处置动作字典", description = "前端据此渲染处置按钮，不必写死文案")
    @GetMapping("/report/actions")
    public Result<List<String>> actions() {
        return Result.success(adminService.adminActions());
    }

    /* ==================== 用户管理 ==================== */

    @Operation(summary = "用户列表", description = "keyword 匹配用户名/昵称；status 不传=全部")
    @GetMapping("/user/list")
    public Result<PageVO<AdminUserItemVO>> users(
            @Parameter(description = "用户名或昵称关键词") @RequestParam(required = false) String keyword,
            @Parameter(description = "0 禁用 1 正常") @RequestParam(required = false) Integer status,
            @Parameter(description = "页码") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(adminService.pageUsers(keyword, status,
                (int) Math.max(page, 1L), (int) Math.min(Math.max(size, 1L), 100L)));
    }

    @Operation(summary = "禁用 / 恢复账号",
            description = "禁自己 90004、禁管理员 90005。禁用后该账号无法登录且写操作被拒")
    @RateLimit(count = 60, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "操作过于频繁，请稍后再试")
    @PutMapping("/user/{id}/status")
    public Result<Void> changeUserStatus(@PathVariable Long id,
                                         @RequestBody @Valid UserStatusDTO dto) {
        adminService.changeUserStatus(id, dto);
        return Result.success();
    }

    /* ==================== 笔记管理 ==================== */

    @Operation(summary = "笔记列表", description = "不过滤状态：运营要看的正是读者看不见的那些")
    @GetMapping("/note/list")
    public Result<PageVO<AdminNoteItemVO>> notes(
            @Parameter(description = "标题/正文/作者关键词") @RequestParam(required = false) String keyword,
            @Parameter(description = "0 草稿 1 发布 2 下架") @RequestParam(required = false) Integer status,
            @Parameter(description = "1 图文 2 视频") @RequestParam(required = false) Integer type,
            @Parameter(description = "页码") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        return Result.success(adminService.pageNotes(keyword, status, type,
                (int) Math.max(page, 1L), (int) Math.min(Math.max(size, 1L), 100L)));
    }

    @Operation(summary = "强制下架 / 恢复笔记",
            description = "1 发布 2 下架。只认这两个值 —— 草稿是作者自己的中间态")
    @RateLimit(count = 60, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "操作过于频繁，请稍后再试")
    @PutMapping("/note/{id}/status")
    public Result<Void> forceNoteStatus(@PathVariable Long id,
                                        @RequestBody @Valid NoteStatusDTO dto) {
        adminService.forceNoteStatus(id, dto);
        return Result.success();
    }
}