package com.xiaoku.module.note.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 笔记实体，对应 note 表。
 *
 * <p><b>刻意不加 {@code @TableLogic}：</b>笔记表没有 {@code deleted} 列，
 * 用 {@code status} 表达生命周期（0 草稿 / 1 正常 / 2 下架）。
 * 逻辑删除用状态位而不是 MP 的删除标记，好处是「下架」和「删除」语义可以分开：
 * 审核不通过是 2，用户自己删也是 2，但前者要保留数据等待申诉。
 */
@Data
@TableName("note")
public class NoteEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long userId;

    /** 1 图文 2 视频 */
    private Integer type;

    private String title;

    private String content;

    private String cover;

    private String videoUrl;

    /** 0 草稿 1 正常 2 下架 */
    private Integer status;

    private Integer likeCount;

    private Integer collectCount;

    private Integer commentCount;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
