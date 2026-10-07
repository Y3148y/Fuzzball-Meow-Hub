package com.xiaoku.module.moderation.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/** 举报，对应 report 表 */
@Data
@TableName("report")
public class ReportEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 举报人 */
    private Long reporterId;

    /** 1笔记 2评论，见 {@link com.xiaoku.module.moderation.enums.ReportTargetType} */
    private Integer targetType;

    private Long targetId;

    /** 见 {@link com.xiaoku.module.moderation.enums.ReportReason} */
    private Integer reasonCode;

    /** 补充说明。入库前截断到 200 字，不是报错 */
    private String detail;

    /** 0待处理 1已受理 2已驳回 */
    private Integer status;

    /** 处置备注（运营回填，本轮没有管理端，先留字段） */
    private String handleNote;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;

    public static final int STATUS_PENDING = 0;
    public static final int STATUS_ACCEPTED = 1;
    public static final int STATUS_REJECTED = 2;
}