package com.xiaoku.module.notification.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.notification.vo.NotificationVO;

/**
 * 通知服务
 *
 * <p>两类职责泾渭分明，别混：
 * <ul>
 *   <li><b>写入</b>（{@code notifyXxx}）：由别的模块在业务成功后调用，
 *       **绝不能抛异常打断主流程** —— 点赞成功却因为「通知写不进去」而回滚，
 *       是本末倒置。所以实现里一律吞异常只记日志。</li>
 *   <li><b>读取</b>（列表/未读数/已读）：走当前登录用户自己的数据，
 *       越权由 SQL 里的 {@code receiver_id = ?} 保证。</li>
 * </ul>
 */
public interface NotificationService {

    /**
     * 通知列表
     *
     * @param onlyUnread true = 只看未读
     */
    PageVO<NotificationVO> pageMyNotifications(int page, int size, boolean onlyUnread);

    /**
     * 未读数（铃铛角标）
     *
     * <p><b>返回 int 而不是 long 是刻意的</b>：Jackson 给 Long/long 注册了
     * {@code ToStringSerializer}（雪花 ID 必须序列化成字符串），所以
     * {@code Result<Long>} 出来会是 {@code "0"} 这种**字符串**，
     * 前端 {@code unread === 0} 恒为 false —— 与 PageVO.total 当年改成
     * Integer 是同一个坑（见 AGENTS 第 6 节）。
     */
    int unreadCount();

    /** 单条标已读；本来就读过或不归当前用户都返回 false（不报错） */
    boolean markRead(Long id);

    /** 全部标已读，返回受影响条数 */
    int markAllRead();

    /* ---------------- 写入（由业务模块调用，失败不影响主流程） ---------------- */

    void notifyNoteLike(Long receiverId, Long actorId, Long noteId);

    /** 评论别人的笔记 */
    void notifyComment(Long receiverId, Long actorId, Long noteId, String content);

    /** 赞别人的评论 */
    void notifyCommentLike(Long receiverId, Long actorId, Long noteId, Long commentId);

    /** 关注别人 */
    void notifyFollow(Long receiverId, Long actorId);

    /** 回复别人的评论：{@code parentCommentId} 是被回复的那条 */
    void notifyCommentReply(Long receiverId, Long actorId, Long noteId,
                            Long parentCommentId, String content);

    /**
     * 被@提及（类型 6）
     *
     * @param content 提及我的那句原文，用于通知列表展示
     */
    void notifyMention(Long receiverId, Long actorId, Long noteId, String content);

    /**
     * 内容被举报（类型 7）
     *
     * @param targetType 1笔记 2评论
     * @param reasonText 举报原因文案，用于通知正文
     */
    void notifyReported(Long receiverId, Long actorId, Long targetId,
                        Integer targetType, String reasonText);
}