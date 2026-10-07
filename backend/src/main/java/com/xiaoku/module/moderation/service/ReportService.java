package com.xiaoku.module.moderation.service;

import com.xiaoku.module.moderation.dto.ReportCreateDTO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 举报：用户对笔记/评论的一次举报
 *
 * <p><b>只做「记录」，不做「处置」</b>：处置（删除内容、禁言作者）是运营的权限，
 * 需要审核与申诉流程，不能由举报这个动作自动触发。这里刻意不提供
 * 「举报即隐藏」—— 那会让任何人都能靠批量举报让别人的笔记消失。
 */
/** 接口 + 实现分成两个文件（与本项目其它 service 一致） */
public interface ReportService {

    /**
     * 举报一条笔记或评论
     *
     * @param userId 举报人（从上下文取，不接受前端传 —— 否则可以冒充别人举报）
     * @return 新建的举报 ID
     * @throws com.xiaoku.common.exception.BizException 重复举报 80003 /
     *         举报自己 80004 / 对象不存在（20001 或 30005）
     */
    Long report(Long userId, ReportCreateDTO dto);
}