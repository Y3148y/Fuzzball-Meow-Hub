package com.xiaoku.module.admin.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 举报处置请求。
 *
 * <p>action 是**处置动作**而不是「改成什么状态」：这两者的区别在不可重放性。
 * 「把状态改成 1」是幂等的，重复执行无害；而「删掉这篇笔记」重复执行就没意义了
 * （第二次对象已经不存在），真正需要防的是**两次不同的处置都作用在同一批内容上** ——
 * 比如先「下架」再「删除」，用户看到的笔记就凭空消失了。
 * 所以 status 由 action 推导，不让调用方直接指定。
 */
@Data
public class ReportHandleDTO {

    /** 处置动作，见 {@code ReportAction} */
    @NotNull(message = "处置动作不能为空")
    @Min(value = 1, message = "处置动作不合法")
    @Max(value = 4, message = "处置动作不合法")
    private Integer action;

    /** 处置备注。会回填到 report.handle_note，也是运营之间交接的唯一信息载体 */
    @Size(max = 200, message = "处置备注不能超过 200 字")
    private String handleNote;
}