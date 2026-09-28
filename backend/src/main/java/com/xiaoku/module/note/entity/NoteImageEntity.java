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
 * 笔记图片实体，对应 note_image 表。
 *
 * <p>图片独立成表而不是塞进 note 的 TEXT 字段，好处是能按 {@code sort} 稳定排序、
 * 也能在 P9 挂 CDN 时批量改写 URL。
 */
@Data
@TableName("note_image")
public class NoteImageEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long noteId;

    private String url;

    private Integer sort;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}
