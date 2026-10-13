package com.xiaoku.module.message.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 单条私信
 *
 * <p>{@code isRead} 是「<b>收件人</b>有没有读过」而不是「发送方视角的已读回执」。
 * 小红书的「已读」是双向都能看到的那种语义；P22 只做接收侧，
 * 发送方在自己这一份列表里看到的就是对方的未读状态。
 */
@Data
@Builder
@Schema(description = "单条私信")
public class MessageVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "消息ID（雪花，序列化成字符串）")
    private Long id;

    @Schema(description = "所属会话ID")
    private Long sessionId;

    @Schema(description = "发送者 userId")
    private Long senderId;

    @Schema(description = "接收者 userId")
    private Long receiverId;

    @Schema(description = "消息正文")
    private String content;

    /**
     * 消息类型：1 文本 2 图片（P32）
     *
     * <p>前端按它决定渲染「气泡」还是「缩略图」。
     * ⚠️ 缺省输出 1 而不是 null —— {@code non_null} 策略下 null 会整个从 JSON 里消失，
     * 而前端 {@code type ?? 1} 与「字段缺失」两条路都要写，收益为零。
     */
    @Schema(description = "消息类型：1 文本 2 图片")
    private Integer type;

    /** 图片 URL，仅 type=2 有值 */
    @Schema(description = "图片 URL，仅图片消息有值")
    private String imageUrl;

    @Schema(description = "0未读 1已读（接收方视角）")
    private Integer isRead;

    @Schema(description = "发送时间")
    private LocalDateTime createTime;
}