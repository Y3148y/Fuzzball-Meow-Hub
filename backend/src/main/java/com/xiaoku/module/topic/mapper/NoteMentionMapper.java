package com.xiaoku.module.topic.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.topic.entity.NoteMentionEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/** 笔记提及（@某人），对应 note_mention 表 */
@Mapper
public interface NoteMentionMapper extends BaseMapper<NoteMentionEntity> {

    /**
     * 取某篇笔记**正文**里被提及的用户 id（P29 加了 comment_id 区分两类提及）。
     *
     * <p>必须带 {@code comment_id = 0}：不加的话评论里的提及也会被捞进来，
     * 于是笔记正文里渲染出一堆「评论时才出现的 @ 链接」——而那段正文里
     * 根本没有对应的 @ 文字，前端按用户名去正文里找，**找不到就是纯文本**，
     * **界面看不出任何异常**。
     */
    @Select("SELECT user_id FROM note_mention WHERE note_id = #{noteId} AND comment_id = #{commentId}")
    List<Long> selectUserIds(@Param("noteId") Long noteId, @Param("commentId") Long commentId);

    /** 取某条评论里被提及的用户 id（comment_id = 该评论 id） */
    @Select("SELECT user_id FROM note_mention WHERE comment_id = #{commentId}")
    List<Long> selectUserIdsByComment(@Param("commentId") Long commentId);

    /**
     * 一次取一批评论的提及，返回 commentId -> userId 列表。
     *
     * <p>评论列表一页 20 条，逐条查就是 20 次往返 —— 这里是 N+1。
     * 返回 Map 而不是让调用方循环：同一批数据只查一次。
     */
    @Select("""
            <script>
            SELECT comment_id, user_id FROM note_mention
            WHERE comment_id IN
            <foreach collection="commentIds" item="cid" open="(" separator="," close=")">#{cid}</foreach>
            </script>
            """)
    List<NoteMentionEntity> selectByCommentIds(@Param("commentIds") List<Long> commentIds);
}