package com.xiaoku.module.comment.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

@Data
@Schema(description = "发表评论请求")
public class CommentCreateDTO {

    /**
     * 笔记ID，<b>刻意用 String 而不是 Long</b>。
     *
     * <p>雪花 ID 是 10^17 量级，超出 JS 的 {@code Number.MAX_SAFE_INTEGER}
     * （约 9.007×10^15）。前端若把它当数字发过来，JSON.parse 阶段就已经
     * 静默四舍五入，<b>我们后端无论声明 Long 还是 String 都救不回来</b>——
     * 收到的就是个错的数。所以约定前端一律按字符串传（见前端
     * {@code types.ts} 的 {@code SnowflakeId = string}），
     * 这里用 String 承接，把"不许发数字"这件事写进类型里而不是只写在文档里。
     */
    @Schema(description = "笔记ID（字符串形式，避免雪花 ID 精度丢失）", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "笔记ID不能为空")
    private String noteId;

    /**
     * 上限 1000，对齐小红书真机。
     *
     * <p>原来是 500（用户反馈"评论区设置字数上限"体验差）。这个数字有个硬约束：
     * {@code sql/schema.sql} 里 {@code comment.content} 是 VARCHAR，不是 TEXT ——
     * 上限超过列宽会在写库那一刻才炸（而且是截断或报错，取决于 sql_mode）。
     * 改上限必须同时改 schema，四个地方一起动：schema.sql / 本 DTO /
     * 前端 {@code NoteDetailView.vue} 的 COMMENT_MAX / contract-test.mjs 的断言。
     */
    @Schema(description = "评论内容", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "评论内容不能为空")
    @Size(max = 1000, message = "评论不能超过 1000 个字")
    private String content;

    /** 父评论ID，不传或传 0 表示发一级评论。同样是字符串理由 */
    @Schema(description = "父评论ID，不传表示发一级评论")
    private String parentId;

    /**
     * 这条评论 @ 了谁（用户ID列表，P30）
     *
     * <p><b>为什么不从正文里解析 @</b>：昵称**允许重复**，解析文本就必须在
     * 「两个都叫『改名了』」时挑一个 —— 而挑错人比不 @ 更糟（通知发给了
     * 完全无关的人）。小红书的做法是**选人那一刻 userId 就定了**，正文里那个
     * {@code @昵称} 只是给人看的装饰。我们对齐这一点：
     * <b>正文只是外观，id 才是事实</b>。
     *
     * <p>代价：手打「@昵称」不会产生提及（前端会明确提示，不是静默失败）；
     * 粘贴别人笔记里的 @ 也不会。前端提交前会过滤掉「正文里已被删掉」的 id，
     * 所以用户把 @ 删了不会误发提及。
     *
     * <p>上限 10，与正文提及沿用同一个 {@code MAX_MENTIONS}。
     */
    @Schema(description = "这条评论 @ 了谁（用户ID列表；正文里的 @ 只是外观，这里才是事实）")
    @Size(max = 10, message = "一条评论最多 @ 10 个人")
    private List<String> mentionUserIds;
}
