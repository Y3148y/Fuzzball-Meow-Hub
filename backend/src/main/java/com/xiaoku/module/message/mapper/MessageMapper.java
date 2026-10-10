package com.xiaoku.module.message.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.message.entity.MessageEntity;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 私信消息 Mapper
 */
@Mapper
public interface MessageMapper extends BaseMapper<MessageEntity> {

    /**
     * 聊天记录分页：<b>取最新的 N 条，但按时间正序返回</b>
     *
     * <p>「先倒序取一页再在 Java 里翻正」是必须的：聊天记录要从**最早**那条
     * 往上滚，而数据库的分页只能从 offset 往后取。所以 SQL 里
     * {@code ORDER BY DESC} 取页，{@code Java 侧 reverse}。
     *
     * <p>排序尾巴是 {@code id} 而不是只要时间：同一毫秒可能有多条
     * （批量造数据、或并发写入时尤其明显），只用 {@code create_time}
     * 会让同一毫秒的消息顺序不稳定，翻页时可能漏掉或重复一条。
     */
    @Select("""
            SELECT * FROM message
            WHERE session_id = #{sessionId}
            ORDER BY create_time DESC, id DESC
            LIMIT #{size} OFFSET #{offset}
            """)
    List<MessageEntity> pageBySessionDesc(@Param("sessionId") Long sessionId,
                                           @Param("offset") long offset,
                                           @Param("size") int size);

    @Select("SELECT COUNT(*) FROM message WHERE session_id = #{sessionId}")
    long countBySession(@Param("sessionId") Long sessionId);

    /**
     * 会话全部标已读
     *
     * <p>条件里带 {@code receiver_id = 我}：聊天记录页的「已读回执」是
     * <b>对方</b>的已读状态，这里是「把我收到的都标已读」，
     * 两个方向不能搞反 —— 否则点开聊天会把自己发出去的消息也标成已读，
     * 而对方那边看到的是「未读」。
     */
    @Update("""
            UPDATE message SET is_read = 1
            WHERE session_id = #{sessionId} AND receiver_id = #{userId} AND is_read = 0
            """)
    int markAllReadInSession(@Param("sessionId") Long sessionId, @Param("userId") Long userId);

    /**
     * 我的总未读消息数（会话页角标）
     *
     * <p>走 {@code idx_receiver_unread}，只 count 不取行。
     * 注意它与会话行上冗余的 {@code unread_low/unread_high} 是<b>两套数</b>：
     * 这里是 ground truth（消息行上的 is_read），那里是列表页的快速读。
     * 契约里有断言钉住两者在正常流程下相等。
     */
    @Select("SELECT COUNT(*) FROM message WHERE receiver_id = #{userId} AND is_read = 0")
    long countUnread(@Param("userId") Long userId);

    /**
     * 会话不可用时（对方注销）清理消息
     *
     * <p>刻意<b>不</b>在删用户时自动调用：私信是两个人的历史，
     * 一方注销不该让另一方的记录凭空消失（与通知的撤回逻辑同源，
     * 见 P21「通知与实际互动不一致」）。这里只提供方法，
     * 供将来做「对方已注销」展示时使用。
     */
    @Delete("DELETE FROM message WHERE session_id = #{sessionId}")
    int deleteBySession(@Param("sessionId") Long sessionId);
}