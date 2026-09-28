package com.xiaoku.module.comment.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/** 评论实体，对应 comment 表 */
@Data
@TableName("comment")
public class CommentEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long noteId;

    /** 评论人 */
    private Long userId;

    /**
     * 根评论ID，0 表示这是一级评论。
     * <p>和 {@link #parentId} 的区别是「树」和「邻接」的区别：
     * 前端按 root_comment_id 一次查出整棵子树再在内存里拼，
     * 后者只知道自己挂在谁下面，回复列表还得再查一次。
     */
    private Long rootCommentId;

    /** 直接父评论ID，0 表示一级评论。回复"回复的回复"时这里会指向二级评论 */
    private Long parentId;

    /** 被回复者ID，0 表示没有回复任何人。用于前端显示"回复 @某人" */
    private Long replyUserId;

    private String content;

    private Integer likeCount;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
