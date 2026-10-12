package com.xiaoku.module.topic.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/** 笔记提及（@某人），对应 note_mention 表 */
@Data
@TableName("note_mention")
public class NoteMentionEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long noteId;
    /**
     * 评论ID；<b>0 = 笔记正文提及</b>（P29）。
     *
     * <p><b>为什么用 0 哨兵而不是 NULL</b>：MySQL 唯一索引里 NULL 与 NULL
     * <b>互不相等</b>，所以 {@code UNIQUE (note_id, comment_id, user_id)}
     * 在 comment_id 为 NULL 时**放行任意重复的笔记提及行** —— 去重直接失效。
     * 用 0 则两类提及共用一条约束：笔记提及 (noteId, 0, userId) 唯一，
     * 评论提及 (noteId, commentId, userId) 唯一。
     */
    private Long commentId;

    /** 被提及的那个用户 */
    private Long userId;

    private LocalDateTime createTime;
}