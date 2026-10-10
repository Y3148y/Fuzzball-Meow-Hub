package com.xiaoku.module.message.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;

/**
 * 发送私信请求
 */
@Data
@Schema(description = "发送私信")
public class MessageSendDTO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /** 对方 userId（雪花 ID，前端当 string 传） */
    @NotNull(message = "接收人不能为空")
    @Schema(description = "对方 userId", requiredMode = Schema.RequiredMode.REQUIRED)
    private Long toUserId;

    /**
     * 消息正文
     *
     * <p>上限 1000 与评论一致（{@code content} 是 VARCHAR(1000)）。
     * 私信是「人跟人说话」，比公开评论更该有长度感，但也要能说完整件事 ——
     * 500 太短（对齐评论时踩过这个坑），2000 会长到列表页塞不下。
     */
    @NotBlank(message = "消息内容不能为空")
    @Size(max = 1000, message = "消息不能超过 1000 字")
    @Schema(description = "消息正文，最多 1000 字", requiredMode = Schema.RequiredMode.REQUIRED)
    private String content;
}