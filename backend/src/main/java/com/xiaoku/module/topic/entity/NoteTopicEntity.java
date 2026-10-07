package com.xiaoku.module.topic.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/** 笔记与话题的关系，对应 note_topic 表 */
@Data
@TableName("note_topic")
public class NoteTopicEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long noteId;

    private Long topicId;

    private LocalDateTime createTime;
}