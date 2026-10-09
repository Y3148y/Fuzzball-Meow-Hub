package com.xiaoku.module.notification.service.impl;

import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.notification.entity.NotificationEntity;
import com.xiaoku.module.notification.enums.NotificationType;
import com.xiaoku.module.notification.mapper.NotificationMapper;
import com.xiaoku.module.notification.service.NotificationService;
import com.xiaoku.module.notification.vo.NotificationVO;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationServiceImpl implements NotificationService {

    /** content 列是 VARCHAR(200)，超长直接截断而不是让 SQL 报错 */
    private static final int CONTENT_MAX = 200;

    private final NotificationMapper notificationMapper;
    private final UserQueryService userQueryService;
    private final NoteMapper noteMapper;

    /* ============================ 读取 ============================ */

    @Override
    public PageVO<NotificationVO> pageMyNotifications(int page, int size, boolean onlyUnread) {
        Long me = UserContextHolder.requireUserId();
        long total = notificationMapper.countList(me, onlyUnread);
        long offset = (long) (page - 1) * size;
        List<NotificationEntity> rows = notificationMapper.pageList(me, onlyUnread, offset, size);
        if (rows.isEmpty()) {
            return PageVO.of(List.of(), total, page, size);
        }
        return PageVO.of(assemble(rows), total, page, size);
    }

    @Override
    public int unreadCount() {
        // Math.toIntExact：真有 2^31+ 条未读时宁可抛异常也不静默回绕成负数
        return Math.toIntExact(notificationMapper.countUnread(UserContextHolder.requireUserId()));
    }

    @Override
    public boolean markRead(Long id) {
        // 越权的人改不到别人的行：SQL 里带了 receiver_id
        return notificationMapper.markRead(UserContextHolder.requireUserId(), id) > 0;
    }

    @Override
    public int markAllRead() {
        return notificationMapper.markAllRead(UserContextHolder.requireUserId());
    }

    /**
     * 实体 → VO：一页里 actor 和 note 都可能重复，各自一次批量查回来
     *
     * <p>作者被注销时 {@code findUserVOMap} 会缺条目，回退成「已注销用户」而不是
     * 整条通知消失 —— 通知是历史事实，不该因为某人改名/注销就查不到。
     */
    private List<NotificationVO> assemble(List<NotificationEntity> rows) {
        Map<Long, UserVO> actors = userQueryService.findUserVOMap(
                rows.stream().map(NotificationEntity::getActorId).toList());

        Map<Long, String> titles = new HashMap<>();
        List<Long> noteIds = rows.stream().map(NotificationEntity::getNoteId)
                .distinct().filter(java.util.Objects::nonNull).toList();
        if (!noteIds.isEmpty()) {
            for (NoteEntity n : noteMapper.selectTitlesByIds(noteIds)) {
                titles.put(n.getId(), n.getTitle());
            }
        }

        return rows.stream().map(e -> {
            UserVO actor = actors.get(e.getActorId());
            NotificationType type = NotificationType.of(e.getType());
            return NotificationVO.builder()
                    .id(e.getId())
                    .type(e.getType())
                    .typeText(type == null ? "新的互动" : type.text())
                    .actorId(e.getActorId())
                    .actorNickname(actor == null ? "已注销用户" : actor.getNickname())
                    .actorAvatar(actor == null ? null : actor.getAvatar())
                    .targetId(e.getTargetId())
                    .noteId(e.getNoteId())
                    .noteTitle(titles.get(e.getNoteId()))
                    .content(e.getContent())
                    .isRead(e.getIsRead())
                    .createTime(e.getCreateTime())
                    .build();
        }).toList();
    }

    /* ============================ 写入 ============================ */

    /**
     * 统一写入口
     *
     * <p>两处「不写」：① 自己对自己做的事（自己赞自己的笔记没有意义）。
     *
     * <p><b>提交后才真正落库</b>：调用方几乎都在 {@code @Transactional} 里，
     * 如果在事务内就写通知，业务回滚了通知还留着 —— 用户会收到一条
     * 「有人赞了你」但那篇笔记压根没被赞。事务外（如无事务的调用）则立即写。
     * 这个约定与笔记域发 Kafka 事件完全一致（见 NoteServiceImpl 的
     * {@code registerAfterCommit}）。
     *
     * <p>{@code targetId} 与 {@code type} 组成 {@code uk_notify_once}：
     * 已存在就只把它标回未读（{@code touchExisting}），不插新行 ——
     * 同一个人反复赞同一篇笔记，通知列表只该有一条。
     */
    private void push(Long receiverId, Long actorId, NotificationType type,
                      Long targetId, Long noteId, String content) {
        if (receiverId == null || actorId == null || receiverId.equals(actorId)) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    write(receiverId, actorId, type, targetId, noteId, content);
                }
            });
            return;
        }
        write(receiverId, actorId, type, targetId, noteId, content);
    }

    /**
     * 真正落库；失败只记日志
     *
     * <p>吞异常的理由：用户要的是「赞成功」，不是「必须收到通知」。
     * 为了一个附属功能把主流程回滚是本末倒置。
     */
    private void write(Long receiverId, Long actorId, NotificationType type,
                       Long targetId, Long noteId, String content) {
        try {
            String brief = brief(content);
            int touched = notificationMapper.touchExisting(
                    receiverId, actorId, type.code(), targetId, brief);
            if (touched > 0) {
                return;
            }
            NotificationEntity e = new NotificationEntity();
            e.setReceiverId(receiverId);
            e.setActorId(actorId);
            e.setType(type.code());
            e.setTargetId(targetId);
            // 注意：noteId 原样存，**不要拿 targetId 兜底**。关注类通知的 noteId
            // 就是 null —— 这一列的语义是「所属笔记」，塞 userId 冒充笔记会让
            // 列表页的标题回填查不到东西（拿用户 ID 去 note 表找标题）。
            e.setNoteId(noteId);
            e.setContent(brief);
            e.setIsRead(0);
            notificationMapper.insert(e);
        } catch (Exception ex) {
            log.warn("写通知失败，已忽略（不影响主流程）receiver={} actor={} type={}",
                    receiverId, actorId, type, ex);
        }
    }

    /* ==================== 撤回（P21） ==================== */

    @Override
    public int retract(Long receiverId, Long actorId, Integer type, Long targetId) {
        if (receiverId == null || actorId == null || type == null || targetId == null) {
            return 0;
        }
        return afterCommit(() -> {
            try {
                int n = notificationMapper.deleteOne(receiverId, actorId, type, targetId);
                if (n > 0) {
                    log.info("撤回通知 receiver={} actor={} type={} target={}", receiverId, actorId, type, targetId);
                }
                return n;
            } catch (Exception ex) {
                // 与写入同一个理由：撤不掉不该让「取消点赞」失败
                log.warn("撤回通知失败，已忽略 receiver={} actor={} type={}", receiverId, actorId, type, ex);
                return 0;
            }
        });
    }

    @Override
    public int retractByNoteId(Long noteId) {
        if (noteId == null) {
            return 0;
        }
        return afterCommit(() -> {
            try {
                return notificationMapper.deleteByNoteId(noteId);
            } catch (Exception ex) {
                log.warn("按笔记撤通知失败，已忽略 noteId={}", noteId, ex);
                return 0;
            }
        });
    }

    @Override
    public int retractByTarget(Integer type, Long targetId) {
        if (type == null || targetId == null) {
            return 0;
        }
        return afterCommit(() -> {
            try {
                return notificationMapper.deleteByTypeAndTarget(type, targetId);
            } catch (Exception ex) {
                log.warn("按对象撤通知失败，已忽略 type={} target={}", type, targetId, ex);
                return 0;
            }
        });
    }

    /**
     * 事务提交后再执行，并返回执行结果。
     *
     * <p>刻意与 {@link #push} 用同一套 afterCommit 约定：事务回滚了通知就不该被动过。
     * 区别在于写入丢弃返回值、撤回要把它交给调用方 —— 调用方要拿它判断
     * 「这条通知是我撤掉的，还是本来就没有」，从而决定要不要提示用户。
     */
    private int afterCommit(java.util.function.Supplier<Integer> action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            return action.get();
        }
        int[] holder = new int[1];
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                holder[0] = action.get();
            }
        });
        return holder[0];
    }

    private static String brief(String content) {
        if (content == null) {
            return null;
        }
        String s = content.strip();
        return s.length() <= CONTENT_MAX ? s : s.substring(0, CONTENT_MAX - 1) + "…";
    }

    @Override
    public void notifyNoteLike(Long receiverId, Long actorId, Long noteId) {
        push(receiverId, actorId, NotificationType.NOTE_LIKE, noteId, noteId, null);
    }

    @Override
    public void notifyComment(Long receiverId, Long actorId, Long noteId, String content) {
        push(receiverId, actorId, NotificationType.COMMENT, noteId, noteId, content);
    }

    @Override
    public void notifyCommentLike(Long receiverId, Long actorId, Long noteId, Long commentId) {
        push(receiverId, actorId, NotificationType.COMMENT_LIKE, commentId, noteId, null);
    }

    @Override
    public void notifyFollow(Long receiverId, Long actorId) {
        push(receiverId, actorId, NotificationType.FOLLOW, receiverId, null, null);
    }

    @Override
    public void notifyCommentReply(Long receiverId, Long actorId, Long noteId,
                                   Long parentCommentId, String content) {
        push(receiverId, actorId, NotificationType.COMMENT_REPLY, parentCommentId, noteId, content);
    }

    @Override
    public void notifyMention(Long receiverId, Long actorId, Long noteId, String content) {
        // 摘一句原文做展示：全文可能有 2000 字，通知列表塞不下也没必要
        push(receiverId, actorId, NotificationType.MENTION, noteId, noteId, excerpt(content));
    }

    @Override
    public void notifyReported(Long receiverId, Long actorId, Long targetId,
                               Integer targetType, String reasonText) {
        // 拉黑关系不在这条通知里体现：被拉黑的人不该收到「XX 举报了你」。
        // 内容写死「某条内容」而不是具体标题 —— 通知列表要显示正文摘要，
        // 而这里刻意不给举报人身份（否则举报人等于暴露）
        String text = (targetType != null && targetType == 2
                ? "你的一条评论被举报（" + reasonText + "），请留意内容规范"
                : "你的笔记被举报（" + reasonText + "），请留意内容规范");
        // targetId 传 noteId；评论举报传 0，通知页「去这条笔记」会因此不显示跳转
        push(receiverId, actorId, NotificationType.REPORTED, targetId, targetId, text);
    }

    /** 通知正文摘要：单行、限长，超出用省略号 */
    private static String excerpt(String content) {
        if (content == null) {
            return null;
        }
        String oneLine = content.replaceAll("\\s+", " ").trim().trim();
        return oneLine.length() <= 60 ? oneLine : oneLine.substring(0, 60) + "…";
    }
}