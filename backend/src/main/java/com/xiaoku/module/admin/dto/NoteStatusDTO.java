package com.xiaoku.module.admin.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 运营强制变更笔记状态。
 *
 * <p>只认 1（发布）/ 2（下架），**刻意不认 0（草稿）**：
 * 草稿是作者自己的中间态，运营没有理由把别人的笔记按回草稿 ——
 * 那会让「这篇笔记消失了但没人下架过」变成可能。草稿的创建入口本身
 * 也只有管理端才有（见 NoteQueryServiceImpl 里status=0 的分支）。
 */
@Data
public class NoteStatusDTO {

    @NotNull(message = "状态不能为空")
    @Min(value = 1, message = "状态只能是 1（发布）或 2（下架）")
    @Max(value = 2, message = "状态只能是 1（发布）或 2（下架）")
    private Integer status;
}