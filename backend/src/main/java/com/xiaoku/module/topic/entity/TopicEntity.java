package com.xiaoku.module.topic.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/** 话题（#标签），对应 topic 表 */
@Data
@TableName("topic")
public class TopicEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 话题名，不含 #，最长 20 字（库列宽 21 是给字符集留余量） */
    private String name;

    private String description;

    /** 1正常 2禁用 */
    private Integer status;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;

    public static final int STATUS_NORMAL = 1;
    public static final int STATUS_DISABLED = 2;
}