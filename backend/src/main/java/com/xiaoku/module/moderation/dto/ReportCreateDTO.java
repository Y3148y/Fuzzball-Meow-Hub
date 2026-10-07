package com.xiaoku.module.moderation.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;

@Data
@Schema(description = "举报请求")
public class ReportCreateDTO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @NotNull(message = "举报对象类型不能为空")
    @Min(value = 1, message = "举报对象类型只能是 1笔记 或 2评论")
    @Max(value = 2, message = "举报对象类型只能是 1笔记 或 2评论")
    @Schema(description = "1笔记 2评论", requiredMode = Schema.RequiredMode.REQUIRED)
    private Integer targetType;

    @NotNull(message = "举报对象 ID 不能为空")
    @Schema(description = "被举报的笔记/评论 ID", requiredMode = Schema.RequiredMode.REQUIRED)
    private Long targetId;

    @NotNull(message = "举报原因不能为空")
    @Min(value = 1, message = "举报原因不合法")
    @Max(value = 6, message = "举报原因不合法")
    @Schema(description = "1垃圾广告 2色情低俗 3违法违规 4侵权 5恶意攻击 6其他",
            requiredMode = Schema.RequiredMode.REQUIRED)
    private Integer reasonCode;

    /**
     * 补充说明，**可空**
     *
     * <p>刻意允许为空：选一个原因就够提交了。把它设成必填会拦掉一大半举报 ——
     * 愿意点「举报」的人里，多数不会再打一段字。
     */
    @Size(max = 200, message = "补充说明不能超过 200 字")
    @Schema(description = "补充说明，最多 200 字，可为空")
    private String detail;
}