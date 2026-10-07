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

    /** 被提及的那个用户 */
    private Long userId;

    private LocalDateTime createTime;
}