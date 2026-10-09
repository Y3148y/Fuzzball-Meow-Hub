package com.xiaoku.module.notification.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.notification.entity.NotificationEntity;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 通知 Mapper
 *
 * <p>列表查询走 {@code idx_receiver_time}（receiver_id, is_read, create_time, id）：
 * 「未读优先、再按时间倒序」正好能用这四列组成的有序索引，MySQL 直接反向扫，
 * 不用 filesort。未读数用 {@code idx_receiver_unread} 覆盖，只数 count 不取行。
 */
@Mapper
public interface NotificationMapper extends BaseMapper<NotificationEntity> {

    /**
     * 通知列表
     *
     * @param onlyUnread true = 只看未读（「只看未读」筛选用）
     * @param offset     分页偏移
     */
    @Select("""
            SELECT n.*
            FROM notification n
            WHERE n.receiver_id = #{receiverId}
              AND (#{onlyUnread} = 0 OR n.is_read = 0)
            ORDER BY n.create_time DESC, n.id DESC
            LIMIT #{size} OFFSET #{offset}
            """)
    List<NotificationEntity> pageList(@Param("receiverId") Long receiverId,
                                      @Param("onlyUnread") boolean onlyUnread,
                                      @Param("offset") long offset,
                                      @Param("size") int size);

    @Select("""
            SELECT COUNT(*)
            FROM notification n
            WHERE n.receiver_id = #{receiverId}
              AND (#{onlyUnread} = 0 OR n.is_read = 0)
            """)
    long countList(@Param("receiverId") Long receiverId,
                   @Param("onlyUnread") boolean onlyUnread);

    /** 未读数（铃铛角标）。用 idx_receiver_unread，只 count 不取行 */
    @Select("""
            SELECT COUNT(*)
            FROM notification
            WHERE receiver_id = #{receiverId} AND is_read = 0
            """)
    long countUnread(@Param("receiverId") Long receiverId);

    /** 全部标已读 */
    @Update("UPDATE notification SET is_read = 1 WHERE receiver_id = #{receiverId} AND is_read = 0")
    int markAllRead(@Param("receiverId") Long receiverId);

    /** 单条标已读；返回 0 说明本来就读过或不归这个人（两种都不该报错） */
    @Update("UPDATE notification SET is_read = 1 WHERE id = #{id} AND receiver_id = #{receiverId} AND is_read = 0")
    int markRead(@Param("receiverId") Long receiverId, @Param("id") Long id);

    /**
     * 重复触发时刷新已有那一条（保留最早的时间，只把 is_read 打回未读）
     *
     * <p>对应 {@code uk_notify_once}：同一个人对同一个对象做同一件事只留一行。
     * 返回 0 表示此前没有过这行，调用方需要 insert。
     */
    @Update("""
            UPDATE notification
            SET is_read = 0,
                content = #{content}
            WHERE receiver_id = #{receiverId}
              AND actor_id = #{actorId}
              AND type = #{type}
              AND target_id = #{targetId}
            """)
int touchExisting(@Param("receiverId") Long receiverId,
                        @Param("actorId") Long actorId,
                        @Param("type") int type,
                        @Param("targetId") Long targetId,
                        @Param("content") String content);

    /* ==================== 撤回（P21） ==================== */

    /**
     * 撤掉唯一的那一条：条件就是 {@code uk_notify_once} 的四个列。
     *
     * <p>刻意<b>只按这四列</b>删，不加 {@code receiver_id} 之外的任何判断：
     * 写入侧的去重维度与此完全一致，撤回必须与它对称 ——
     * 少删会让「取消点赞了还收到通知」，多删会误伤别人的通知。
     */
    @Delete("""
            DELETE FROM notification
            WHERE receiver_id = #{receiverId}
              AND actor_id = #{actorId}
              AND type = #{type}
              AND target_id = #{targetId}
            """)
    int deleteOne(@Param("receiverId") Long receiverId,
                  @Param("actorId") Long actorId,
                  @Param("type") int type,
                  @Param("targetId") Long targetId);

    /**
     * 按笔记撤掉全部通知。
     *
     * <p>走 {@code idx_receiver_time} 的左前缀吗？—— **走不了**：
     * {@code idx_receiver_time} 第一列是 {@code receiver_id}，而这里没有它，
     * 所以是全表扫。通知表的写入只发生在互动发生的瞬间（低频），
     * 删笔记更是低频，这个代价可以接受。真要优化就得加一条
     * {@code idx_note_id}，而那会让每次写通知多维护一个索引 ——
     * 为了一个低频读加高频写的成本，不划算。
     */
    @Delete("DELETE FROM notification WHERE note_id = #{noteId}")
    int deleteByNoteId(@Param("noteId") Long noteId);

    /** 按「类型 + 对象」撤。评论被删时用它，同时覆盖「赞评论」「回复」两类通知 */
    @Delete("""
            DELETE FROM notification
            WHERE type = #{type} AND target_id = #{targetId}
            """)
    int deleteByTypeAndTarget(@Param("type") int type, @Param("targetId") Long targetId);
}