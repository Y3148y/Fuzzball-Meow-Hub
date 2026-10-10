package com.xiaoku.module.message.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.message.entity.MessageSessionEntity;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 私信会话 Mapper
 *
 * <p>会话行是「一对人一行」，所以绝大多数查询都是<b>以「我」为锚</b>：
 * 要么 {@code user_low_id = 我}，要么 {@code user_high_id = 我}。
 * 两侧各留一个索引（{@code idx_low_time} / {@code idx_high_time}）就是为这个。
 */
@Mapper
public interface MessageSessionMapper extends BaseMapper<MessageSessionEntity> {

    /**
     * 按规范化后的双向键查会话
     *
     * <p>调用方负责把两个 userId 排好序再传进来（{@code MessageServiceImpl.normalize}）。
     * 这个方法<b>只负责查</b>，不负责「查不到就插」 —— 那个动作要配合
     * {@link #insertIgnore} 用唯一索引兜底，而不是先查再插（check-then-act 竞态）。
     */
    @Select("""
            SELECT * FROM message_session
            WHERE user_low_id = #{lowId} AND user_high_id = #{highId}
            LIMIT 1
            """)
    MessageSessionEntity selectByPair(@Param("lowId") Long lowId, @Param("highId") Long highId);

    /**
     * 查不到时插入，靠唯一索引判重复
     *
     * <p><b>为什么不用 {@code SELECT} 然后 {@code INSERT}</b>：A 与 B 同时首次发消息时，
     * 两个事务都会查到「不存在」，然后都去插 —— 后一个撞 {@code uk_session_pair}
     * 抛异常一路冒到接口变成 500。竞态收进 SQL 内部，谁先插成功另一个静默跳过，
     * 调用方随后再查一次即可拿到确定的那一行。这与 {@code topic} 的
     * {@code INSERT IGNORE} 是同一套做法。
     *
     * @return 1=本次插入 0=已存在（被唯一索引挡下）
     */
    @Insert("""
            INSERT IGNORE INTO message_session
              (id, user_low_id, user_high_id, unread_low, unread_high)
            VALUES
              (#{id}, #{lowId}, #{highId}, 0, 0)
            """)
    int insertIgnore(@Param("id") Long id, @Param("lowId") Long lowId, @Param("highId") Long highId);

    /**
     * 会话列表：「我参与的所有会话，按最后一条消息倒序」
     *
     * <p>两个方向用 UNION 合并而不是 OR：{@code OR} 会让优化器只能二选一索引
     * （甚至全表扫），而 {@code UNION} 两侧各走各的索引再归并。
     * 排序键用 {@code last_time}，它为 NULL 的行（刚建还没发过消息）会排到最后 ——
     * 用 {@code (last_time IS NULL)} 作为第一排序键，比 COALESCE 到
     * {@code create_time} 便宜（后者要每行做一次函数求值）。
     *
     * <p>刻意<b>不加</b> {@code <script>}：这段 SQL 没有动态部分，
     * 而 {@code <script>} 会让 MyBatis 把内容当 XML 解析 ——
     * 一旦将来有人加了带 {@code <} 的条件就会踩 SAXParseException（见 P18 段）。
     */
    @Select("""
            SELECT * FROM (
              SELECT * FROM message_session WHERE user_low_id = #{userId}
              UNION
              SELECT * FROM message_session WHERE user_high_id = #{userId}
            ) t
            ORDER BY (last_time IS NULL), last_time DESC, id DESC
            LIMIT #{size} OFFSET #{offset}
            """)
    List<MessageSessionEntity> pageMySessions(@Param("userId") Long userId,
                                              @Param("offset") long offset,
                                              @Param("size") int size);

    @Select("""
            SELECT COUNT(*) FROM (
              SELECT id FROM message_session WHERE user_low_id = #{userId}
              UNION
              SELECT id FROM message_session WHERE user_high_id = #{userId}
            ) t
            """)
    long countMySessions(@Param("userId") Long userId);

    /**
     * 会话行上「最后一条」与对方未读数一起推进
     *
     * <p>刻意做成<b>一条 UPDATE 同时改三列</b>而不是三条：会话列表页的排序键
     * 与未读数必须在同一个事务里落库，否则会出现「排序键更新了但未读数没更新」
     * 这种中间态 —— 而这个中间态正好是用户会看到的（列表刚刷新、角标还没跳）。
     *
     * <p>未读数<b>自增 1</b>而不是绝对值覆盖：发消息这个动作在事务内一定会执行
     * 一次，重试（幂等头回放）被 {@code @Idempotent} 挡在进方法之前，
     * 不会出现「同一条消息被计两次」。
     */
    @Update("""
            UPDATE message_session
            SET last_message = #{brief},
                last_time   = #{time},
                unread_low  = unread_low  + CASE WHEN #{lowIsReceiver} THEN 1 ELSE 0 END,
                unread_high = unread_high + CASE WHEN #{highIsReceiver} THEN 1 ELSE 0 END
            WHERE id = #{sessionId}
            """)
    int advanceOnSend(@Param("sessionId") Long sessionId,
                      @Param("brief") String brief,
                      @Param("time") java.time.LocalDateTime time,
                      @Param("lowIsReceiver") boolean lowIsReceiver,
                      @Param("highIsReceiver") boolean highIsReceiver);

    /**
     * 会话全部已读：清零「我」这一侧的未读数
     *
     * <p>用<b>绝对值 0</b>而不是「减掉本页条数」：清零是幂等的，
     * 而减法重复执行会减成负数（虽然有 {@code GREATEST} 兜底，但那时
     * 数据已经错了 —— 只是错误被藏起来）。这是 P8 计数异步落库用同一套
     * 「绝对值覆盖」思路的原因。
     */
    @Update("""
            UPDATE message_session
            SET unread_low  = CASE WHEN user_low_id  = #{userId} THEN 0 ELSE unread_low  END,
                unread_high = CASE WHEN user_high_id = #{userId} THEN 0 ELSE unread_high END
            WHERE id = #{sessionId}
              AND (user_low_id = #{userId} OR user_high_id = #{userId})
            """)
    int clearUnread(@Param("sessionId") Long sessionId, @Param("userId") Long userId);

    /** 我的总未读数（会话页角标用）—— 两侧相加，两条行各走自己的索引 */
    @Select("""
            SELECT COALESCE(SUM(u), 0) FROM (
              SELECT unread_low AS u FROM message_session WHERE user_low_id = #{userId}
              UNION ALL
              SELECT unread_high AS u FROM message_session WHERE user_high_id = #{userId}
            ) t
            """)
    long sumUnread(@Param("userId") Long userId);
}