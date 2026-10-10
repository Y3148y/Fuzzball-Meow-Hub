package com.xiaoku.module.message.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 私信会话（会话列表的一行）
 *
 * <p>{@code unread} 是「<b>对方</b>发给我、我还没读」的条数，
 * 也是 P18 里 {@code authorFollowed} 那种「实时算而不是推断」的量 ——
 * 列表里出现一个会话不代表里面有未读（有可能是我自己刚发的）。
 */
@Data
@Builder
@Schema(description = "私信会话")
public class MessageSessionVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "会话ID")
    private Long sessionId;

    @Schema(description = "对方 userId")
    private Long peerId;

    @Schema(description = "对方昵称")
    private String peerNickname;

    @Schema(description = "对方头像")
    private String peerAvatar;

    @Schema(description = "最后一条消息摘要")
    private String lastMessage;

    @Schema(description = "最后一条消息时间（会话列表排序键）")
    private LocalDateTime lastTime;

    @Schema(description = "我还没读的条数")
    private Integer unread;
}