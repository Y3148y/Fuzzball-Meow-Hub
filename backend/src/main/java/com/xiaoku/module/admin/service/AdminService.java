package com.xiaoku.module.admin.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.admin.dto.NoteStatusDTO;
import com.xiaoku.module.admin.dto.ReportHandleDTO;
import com.xiaoku.module.admin.dto.UserStatusDTO;
import com.xiaoku.module.admin.vo.AdminNoteItemVO;
import com.xiaoku.module.admin.vo.AdminReportVO;
import com.xiaoku.module.admin.vo.AdminUserItemVO;

import java.util.List;

/**
 * 运营后台。
 *
 * <p>⚠️ <b>本接口的实现<b>不做权限判断</b>，那由 {@code AdminInterceptor} 统一负责。</p>
 * 刻意不在每个 service 方法里写「if (!isAdmin()) throw」——
 * 那样的检查散落在十几个方法里，漏一个就是一个静默越权。
 * 而权限判断放在拦截器上是<b>默认全保护</b>：新加的 admin 接口路径一定以
 * /api/admin 开头，一漏就是整条前缀都漏，测试会立刻炸。
 * 反过来，注解式（@RequireAdmin）漏加就是<b>静默放行</b>，没人会发现。
 */
public interface AdminService {

    /* ==================== 举报处置 ==================== */

    /**
     * 举报列表（运营视角，带被举报内容与举报人）。
     *
     * @param status 0 待处理 / 1 已受理 / 2 已驳回；null = 全部
     */
    PageVO<AdminReportVO> pageReports(Integer status, Integer targetType, int page, int size);

    /** 待处理举报数，用于运营首页的红点。不分页，跑 count 就够 */
    long countPendingReports();

    /** 处置一条举报 */
    void handleReport(Long reportId, ReportHandleDTO dto);

    /* ==================== 用户管理 ==================== */

    PageVO<AdminUserItemVO> pageUsers(String keyword, Integer status, int page, int size);

    /** 禁用 / 恢复一个账号 */
    void changeUserStatus(Long userId, UserStatusDTO dto);

    /* ==================== 笔记管理 ==================== */

    PageVO<AdminNoteItemVO> pageNotes(String keyword, Integer status, Integer type, int page, int size);

    /** 强制下架 / 恢复一篇笔记（绕过「只有作者能改」的门禁） */
    void forceNoteStatus(Long noteId, NoteStatusDTO dto);

    /** 供契约/调试确认当前操作人是不是管理员 */
    List<String> adminActions();
}