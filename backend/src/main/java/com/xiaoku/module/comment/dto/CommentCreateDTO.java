package com.xiaoku.module.comment.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

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

    @Schema(description = "评论内容", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "评论内容不能为空")
    @Size(max = 500, message = "评论不能超过 500 个字")
    private String content;

    /** 父评论ID，不传或传 0 表示发一级评论。同样是字符串理由 */
    @Schema(description = "父评论ID，不传表示发一级评论")
    private String parentId;
}
