package com.xiaoku.module.message.dto;

import io.swagger.v3.oas.annotations.media.Schema;
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
     *
     * <p>⚠️ **P32 起对图片消息不再强制非空**：`@NotBlank` 是无条件生效的，
     * 而图片消息的 content 恒为空串 —— 两者直接冲突。
     * 校验改成在 service 里按 {@code type} 分支判断（见
     * {@code MessageServiceImpl.validate}），这样「文本必须有正文、
     * 图片必须有 URL」两条规则各自独立，而不是互相把对方的用例挡掉。
     * 保留 {@code @Size} 只是为了给超长正文一个明确的报错文案。
     */
    @Size(max = 1000, message = "消息不能超过 1000 字")
    @Schema(description = "消息正文，最多 1000 字；图片消息可为空")
    private String content;

    /**
     * 消息类型：1 文本 2 图片（缺省 1）
     *
     * <p>⚠️ 刻意**允许 null** 并在 service 里兜成 1：老客户端（以及所有
     * 存量测试）都不会传这个字段，若用 {@code @NotNull} 会把整个 P22 的
     * 接口一次性打断，而「缺省就是文本」本来就是这条字段的自然语义。
     */
    @Schema(description = "消息类型：1 文本 2 图片，缺省 1")
    private Integer type;

    /**
     * 图片 URL（type=2 必填）
     *
     * <p>刻意**只认站内相对路径或本项目域名下的 URL**：允许传任意外链等于
     * 让用户把「图片」做成一个可点的钓鱼链接，而 IM 里的图片恰恰是最不像
     * 链接、最容易骗过人的位置。校验放在 service 而非注解 ——
     * 注解只能做长度与非空，做不了「这个 host 是不是我们自己」。
     */
    @Size(max = 500, message = "图片地址过长")
    @Schema(description = "图片 URL，type=2 时必填")
    private String imageUrl;
}