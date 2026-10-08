package com.xiaoku.module.admin.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 用户状态变更（禁用 / 恢复）。
 *
 * <p>刻意<b>不收 reason</b>：被禁用的人看不到任何原因说明，
 * 存了也只是一行没人读的字。要给用户看的话应该走独立的申诉通道，
 * 而不是把运营的内部备注塞进状态里。
 */
@Data
public class UserStatusDTO {

    /** 0 禁用 1 正常 */
    @NotNull(message = "状态不能为空")
    @Min(value = 0, message = "状态只能是 0（禁用）或 1（正常）")
    @Max(value = 1, message = "状态只能是 0（禁用）或 1（正常）")
    private Integer status;
}