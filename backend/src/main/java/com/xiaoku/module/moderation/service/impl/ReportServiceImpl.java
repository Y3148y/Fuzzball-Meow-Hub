package com.xiaoku.module.moderation.service.impl;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.module.comment.entity.CommentEntity;
import com.xiaoku.module.comment.mapper.CommentMapper;
import com.xiaoku.module.moderation.dto.ReportCreateDTO;
import com.xiaoku.module.moderation.entity.ReportEntity;
import com.xiaoku.module.moderation.enums.ReportReason;
import com.xiaoku.module.moderation.enums.ReportTargetType;
import com.xiaoku.module.moderation.mapper.ReportMapper;
import com.xiaoku.module.moderation.service.ReportService;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.notification.service.NotificationService;
import com.xiaoku.module.user.mapper.UserBlockMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 举报实现
 *
 * <p>三条「不做」比三条「做」更值得记住：
 * <ol>
 *   <li><b>不自动处置</b>：举报只记录，删内容/禁言是运营的权限。</li>
 *   <li><b>不举报自己的内容</b>：没有意义，还会把运营后台灌满噪声。</li>
 *   <li><b>不因「已拉黑」而拒绝举报</b>：拉黑是私人屏蔽，举报是公共治理，
 *       两者语义不同；被拉黑了还想举报也应该能报。</li>
 * </ol>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReportServiceImpl implements ReportService {

    /** 补充说明的上限，与 report.detail 的列宽一致。超了截断而不是报错 */
    private static final int DETAIL_MAX = 200;

    private final ReportMapper reportMapper;
    private final NoteMapper noteMapper;
    private final CommentMapper commentMapper;
    private final UserBlockMapper userBlockMapper;
    private final NotificationService notificationService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long report(Long userId, ReportCreateDTO dto) {
        ReportTargetType targetType = ReportTargetType.of(dto.getTargetType());
        ReportReason reason = ReportReason.of(dto.getReasonCode());
        if (targetType == null || reason == null) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "举报参数不合法");
        }

        // 目标必须存在，且拿到作者 id —— 不存在就报「不存在」，
        // 与笔记/评论自己的错误码一致，不另造一个「举报对象无效」
        Long ownerId = resolveOwner(targetType, dto.getTargetId());
        if (userId.equals(ownerId)) {
            throw new BizException(ErrorCodeEnum.CANNOT_REPORT_SELF);
        }

        // 先查是否已举报过：为了给用户一个明确的「你已经举报过了，会尽快处理」，
        // 而不是让唯一索引异常冒成 500。
        // 真正防并发的是下面的 uk_report_once —— 两个请求同时进来，
        // 第二个会撞唯一索引，那条路径按「重复举报」兜住。
        boolean exists = reportMapper.exists(Wrappers.<ReportEntity>lambdaQuery()
                .eq(ReportEntity::getReporterId, userId)
                .eq(ReportEntity::getTargetType, targetType.code())
                .eq(ReportEntity::getTargetId, dto.getTargetId()));
        if (exists) {
            throw new BizException(ErrorCodeEnum.ALREADY_REPORTED);
        }

        ReportEntity report = new ReportEntity();
        report.setId(IdWorker.getId());
        report.setReporterId(userId);
        report.setTargetType(targetType.code());
        report.setTargetId(dto.getTargetId());
        report.setReasonCode(reason.code());
        report.setDetail(truncate(dto.getDetail()));
        report.setStatus(ReportEntity.STATUS_PENDING);
        try {
            reportMapper.insert(report);
        } catch (org.springframework.dao.DuplicateKeyException e) {
            // 并发下同一个人重复提交：撞 uk_report_once。
            // 翻译成业务错误而不是 500 —— 用户的意图（举报一次）已经达成了
            throw new BizException(ErrorCodeEnum.ALREADY_REPORTED);
        }

        // 通知作者「你的内容被举报」。与其它通知一样 afterCommit + 吞异常：
        // 举报记录已经落库，通知失败不该让它看起来像失败。
        // ⚠️ 拉黑关系不在这条通知里体现：被拉黑的人不该收到「XX 举报了你」的通知。
        notificationService.notifyReported(ownerId, userId, dto.getTargetId(),
                targetType.code(), reason.text());

        log.info("举报已记录 reporterId={} targetType={} targetId={} reason={}",
                userId, targetType.code(), dto.getTargetId(), reason.code());
        return report.getId();
    }

    /** 拿到被举报内容的作者 id；内容不存在就按对应域的错误码抛 */
    private Long resolveOwner(ReportTargetType type, Long targetId) {
        if (type == ReportTargetType.NOTE) {
            NoteEntity note = noteMapper.selectById(targetId);
            if (note == null) {
                throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
            }
            return note.getUserId();
        }
        CommentEntity comment = commentMapper.selectById(targetId);
        if (comment == null) {
            throw new BizException(ErrorCodeEnum.COMMENT_NOT_FOUND);
        }
        return comment.getUserId();
    }

    private static String truncate(String detail) {
        if (detail == null || detail.isBlank()) {
            return null;
        }
        String s = detail.strip();
        return s.length() <= DETAIL_MAX ? s : s.substring(0, DETAIL_MAX);
    }

    /** 供契约/调试确认「某条内容被举报过」 */
    public long countReports(Integer targetType, Long targetId) {
        return reportMapper.selectCount(Wrappers.<ReportEntity>lambdaQuery()
                .eq(ReportEntity::getTargetType, targetType)
                .eq(ReportEntity::getTargetId, targetId));
    }

    /** 供测试确认黑名单过滤器真的被装配了 */
    public boolean blocked(Long userId, Long otherId) {
        return userBlockMapper.exists(Wrappers.<com.xiaoku.module.user.entity.UserBlockEntity>lambdaQuery()
                .eq(com.xiaoku.module.user.entity.UserBlockEntity::getUserId, userId)
                .eq(com.xiaoku.module.user.entity.UserBlockEntity::getBlockedId, otherId));
    }
}