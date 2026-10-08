package com.xiaoku.module.admin.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.admin.dto.NoteStatusDTO;
import com.xiaoku.module.admin.dto.ReportHandleDTO;
import com.xiaoku.module.admin.dto.UserStatusDTO;
import com.xiaoku.module.admin.enums.ReportAction;
import com.xiaoku.module.admin.mapper.AdminMapper;
import com.xiaoku.module.admin.service.AdminService;
import com.xiaoku.module.admin.vo.AdminNoteItemVO;
import com.xiaoku.module.admin.vo.AdminReportVO;
import com.xiaoku.module.admin.vo.AdminUserItemVO;
import com.xiaoku.module.comment.entity.CommentEntity;
import com.xiaoku.module.comment.mapper.CommentMapper;
import com.xiaoku.module.moderation.entity.ReportEntity;
import com.xiaoku.module.moderation.enums.ReportReason;
import com.xiaoku.module.moderation.mapper.ReportMapper;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.service.NoteService;
import com.xiaoku.module.user.entity.UserEntity;
import com.xiaoku.module.user.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 运营后台实现。
 *
 * <p>三条贯穿全局的取舍：
 * <ol>
 *   <li><b>处置动作不可重放</b>：已处理的举报再处置一律 90003。
 *       「删笔记」这种动作重复执行第二次会碰到「对象已经不存在」，
 *       而真正的风险是两次不同的处置落在同一批内容上（先下架再删除，
 *       用户看到的笔记就凭空消失了）。</li>
 *   <li><b>被举报内容可能已经不存在</b>：作者自己删了、或被上一条处置删了。
 *       这时列表里对应字段为 null，运营应当直接驳回 —— 而不是报「处理失败」。</li>
 *   <li><b>禁用账号是账号级动作，与内容处置分开</b>：禁言/封号针对的是
 *       「这个人反复发违规内容」，一次举报不足以禁言。所以 BAN_AUTHOR
 *       不在这条举报的处置里自动生效，也不需要运营二次确认。</li>
 * </ol>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminServiceImpl implements AdminService {

    /** 运营列表正文截断长度：判断违规只看开头，全量传长文是浪费 */
    private static final int CONTENT_PREVIEW = 100;

    private final AdminMapper adminMapper;
    private final ReportMapper reportMapper;
    private final NoteMapper noteMapper;
    private final CommentMapper commentMapper;
    private final UserMapper userMapper;
    private final NoteService noteService;

    /* ==================== 举报处置 ==================== */

    @Override
    public PageVO<AdminReportVO> pageReports(Integer status, Integer targetType, int page, int size) {
        int p = Math.max(page, 1);
        int s = (int) Math.min(Math.max(size, 1L), 100L);
        long total = adminMapper.countReports(status, targetType);
        List<Map<String, Object>> rows =
                adminMapper.pageReports(status, targetType, (long) (p - 1) * s, s);
        List<AdminReportVO> list = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            list.add(toReportVO(row));
        }
        return PageVO.<AdminReportVO>builder().list(list).total((int) total).page(p).size(s).build();
    }

    @Override
    public long countPendingReports() {
        return adminMapper.countReports(ReportEntity.STATUS_PENDING, null);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void handleReport(Long reportId, ReportHandleDTO dto) {
        ReportAction action = ReportAction.of(dto.getAction());
        if (action == null) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "处置动作不合法");
        }

        ReportEntity report = reportMapper.selectById(reportId);
        if (report == null) {
            throw new BizException(ErrorCodeEnum.REPORT_NOT_FOUND);
        }
        if (!Integer.valueOf(ReportEntity.STATUS_PENDING).equals(report.getStatus())) {
            // 不可重放：这是本接口最重要的一条规则。没有它，两次点「删除」
            // 会静默成功两次，而中间任何一次审计都只看到 status=1
            throw new BizException(ErrorCodeEnum.REPORT_ALREADY_HANDLED);
        }

        // 评论没有「下架」这个状态，只有「删掉」或「驳回」。
        // 报出来的是「这个动作对该对象无效」而不是静默忽略 ——
        // 静默忽略会让运营以为下架成功了
        boolean isNote = Integer.valueOf(1).equals(report.getTargetType());
        if (action.affectsNote() && !isNote) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "评论不能下架，请改用「删除作者」或「驳回」");
        }

        Long authorId = null;
        if (action.affectsNote()) {
            // 下架与删除：作者先记住（删除会把笔记行带走，之后就查不到了）
            authorId = resolveAuthorId(isNote, report.getTargetId());
            if (action == ReportAction.DELETE_NOTE) {
                deleteNoteAsAdmin(report.getTargetId());
            } else {
                noteService.forceChangeStatus(report.getTargetId(), 2);
            }
        } else if (action == ReportAction.BAN_AUTHOR) {
            authorId = resolveAuthorId(isNote, report.getTargetId());
            banUser(authorId, "举报处置：内容违规");
        }
        // REJECT：只改举报状态，不碰内容（作者 id 也就没有意义了）

        reportMapper.update(null, Wrappers.<ReportEntity>lambdaUpdate()
                .eq(ReportEntity::getId, reportId)
                .eq(ReportEntity::getStatus, ReportEntity.STATUS_PENDING)
                .set(ReportEntity::getStatus, action.resultStatus())
                .set(ReportEntity::getHandleNote, dto.getHandleNote())
                .set(ReportEntity::getUpdateTime, LocalDateTime.now()));

        log.info("举报已处置 reportId={} action={} targetType={} targetId={} authorId={}",
                reportId, action.name(), report.getTargetType(), report.getTargetId(), authorId);
    }

    /** 运营删除笔记：作者不在场，delete 里的「非作者一律 20001」会挡住，所以走 deleteAsAdmin */
    private void deleteNoteAsAdmin(Long noteId) {
        if (noteMapper.selectById(noteId) == null) {
            // 内容已经不在了（作者自己删了 / 被前一次处置删了）：
            // 当作处置成功继续，不再删一次。用户要的是「这条违规内容不在了」
            return;
        }
        noteService.deleteAsAdmin(noteId);
    }

    /* ==================== 用户管理 ==================== */

    @Override
    public PageVO<AdminUserItemVO> pageUsers(String keyword, Integer status, int page, int size) {
        int p = Math.max(page, 1);
        int s = (int) Math.min(Math.max(size, 1L), 100L);
        String kw = (keyword == null || keyword.isBlank()) ? null : keyword.strip();
        long total = adminMapper.countUsers(kw, status);
        List<AdminUserItemVO> list = adminMapper.pageUsers(kw, status, (long) (p - 1) * s, s);
        return PageVO.<AdminUserItemVO>builder().list(list).total((int) total).page(p).size(s).build();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void changeUserStatus(Long userId, UserStatusDTO dto) {
        UserEntity target = userMapper.selectById(userId);
        if (target == null) {
            throw new BizException(ErrorCodeEnum.ADMIN_TARGET_NOT_FOUND);
        }
        // 三个「不能」：禁自己（把自己关在门外且无人能解）、禁另一个管理员
        //（管理员之间不该有权互相封禁 —— 否则一个运营能把自己这条线的同事全干掉）、
        // 以及把最后一条自我保护路径也堵上
        Long operatorId = UserContextHolder.requireUserId();
        if (userId.equals(operatorId)) {
            throw new BizException(ErrorCodeEnum.CANNOT_DISABLE_SELF);
        }
        if (Integer.valueOf(1).equals(target.getRole())) {
            throw new BizException(ErrorCodeEnum.CANNOT_DISABLE_ADMIN);
        }
        if (Objects.equals(target.getStatus(), dto.getStatus())) {
            return;
        }
        userMapper.update(null, Wrappers.<UserEntity>lambdaUpdate()
                .eq(UserEntity::getId, userId)
                .set(UserEntity::getStatus, dto.getStatus())
                .set(UserEntity::getUpdateTime, LocalDateTime.now()));
        log.info("运营变更账号状态 userId={} status={} operator={}", userId, dto.getStatus(), operatorId);
    }

    /* ==================== 笔记管理 ==================== */

    @Override
    public PageVO<AdminNoteItemVO> pageNotes(String keyword, Integer status, Integer type,
                                             int page, int size) {
        int p = Math.max(page, 1);
        int s = (int) Math.min(Math.max(size, 1L), 100L);
        String kw = (keyword == null || keyword.isBlank()) ? null : keyword.strip();
        long total = adminMapper.countNotes(kw, status, type);
        List<AdminNoteItemVO> list = adminMapper.pageNotes(kw, status, type, (long) (p - 1) * s, s);
        list.forEach(n -> n.setContent(truncate(n.getContent())));
        return PageVO.<AdminNoteItemVO>builder().list(list).total((int) total).page(p).size(s).build();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void forceNoteStatus(Long noteId, NoteStatusDTO dto) {
        noteService.forceChangeStatus(noteId, dto.getStatus());
    }

    /* ==================== 内部 ==================== */

    private AdminReportVO toReportVO(Map<String, Object> row) {
        AdminReportVO vo = new AdminReportVO();
        vo.setId(num(row.get("id")));
        vo.setTargetType(intOf(row.get("target_type")));
        vo.setTargetId(num(row.get("target_id")));
        vo.setReasonCode(intOf(row.get("reason_code")));
        ReportReason reason = ReportReason.of(vo.getReasonCode());
        vo.setReasonText(reason == null ? null : reason.text());
        vo.setDetail((String) row.get("detail"));
        vo.setStatus(intOf(row.get("status")));
        vo.setHandleNote((String) row.get("handle_note"));
        vo.setReporterNickname((String) row.get("reporter_nickname"));
        vo.setReporterUsername((String) row.get("reporter_username"));
        vo.setCreateTime(time(row.get("create_time")));
        vo.setHandleTime(time(row.get("update_time")));
        fillTarget(vo);
        return vo;
    }

    /** 把被举报内容的摘要补上。内容已不存在时留 null 并把 targetExists 置 false */
    private void fillTarget(AdminReportVO vo) {
        if (Integer.valueOf(1).equals(vo.getTargetType())) {
            NoteEntity note = noteMapper.selectById(vo.getTargetId());
            if (note == null) {
                vo.setTargetExists(false);
                return;
            }
            vo.setTargetExists(true);
            vo.setTargetTitle(note.getTitle());
            vo.setTargetContent(truncate(note.getContent()));
            vo.setTargetAuthorId(note.getUserId());
            fillAuthorNickname(vo, note.getUserId());
        } else {
            CommentEntity comment = commentMapper.selectById(vo.getTargetId());
            if (comment == null) {
                vo.setTargetExists(false);
                return;
            }
            vo.setTargetExists(true);
            vo.setTargetContent(truncate(comment.getContent()));
            vo.setTargetAuthorId(comment.getUserId());
            fillAuthorNickname(vo, comment.getUserId());
        }
    }

    private void fillAuthorNickname(AdminReportVO vo, Long authorId) {
        UserEntity author = userMapper.selectById(authorId);
        if (author != null) {
            vo.setTargetAuthorNickname(author.getNickname());
        }
    }

    private Long resolveAuthorId(boolean isNote, Long targetId) {
        if (isNote) {
            NoteEntity note = noteMapper.selectById(targetId);
            return note == null ? null : note.getUserId();
        }
        CommentEntity comment = commentMapper.selectById(targetId);
        return comment == null ? null : comment.getUserId();
    }

    private void banUser(Long userId, String reason) {
        if (userId == null) {
            return;
        }
        UserEntity user = userMapper.selectById(userId);
        // 作者自己删了内容 → 人可能还在；管理员账号不因内容问题被处置
        if (user == null || Integer.valueOf(1).equals(user.getRole())) {
            return;
        }
        userMapper.update(null, Wrappers.<UserEntity>lambdaUpdate()
                .eq(UserEntity::getId, userId)
                .set(UserEntity::getStatus, 0)
                .set(UserEntity::getUpdateTime, LocalDateTime.now()));
        log.warn("处置禁用账号 userId={} reason={}", userId, reason);
    }

    @Override
    public List<String> adminActions() {
        List<String> out = new ArrayList<>();
        for (ReportAction a : ReportAction.values()) {
            out.add(a.code() + "=" + a.text());
        }
        return out;
    }

    private static String truncate(String s) {
        if (s == null) {
            return null;
        }
        String t = s.strip();
        return t.length() <= CONTENT_PREVIEW ? t : t.substring(0, CONTENT_PREVIEW) + "…";
    }

    private static boolean Objects_equals(Integer a, Integer b) {
        return Objects.equals(a, b);
    }

    /** Map 里都是 java.sql 的 Long/Integer，取值时统一转一次，免得每处写 cast */
    private static Long num(Object o) {
        return o == null ? null : ((Number) o).longValue();
    }

    private static Integer intOf(Object o) {
        return o == null ? null : ((Number) o).intValue();
    }

    private static LocalDateTime time(Object o) {
        if (o instanceof LocalDateTime dt) {
            return dt;
        }
        if (o instanceof java.util.Date d) {
            return LocalDateTime.ofInstant(d.toInstant(), java.time.ZoneId.systemDefault());
        }
        return null;
    }
}