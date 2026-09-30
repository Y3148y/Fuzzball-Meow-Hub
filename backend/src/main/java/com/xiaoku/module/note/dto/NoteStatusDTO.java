package com.xiaoku.module.note.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 笔记上下架请求。
 *
 * <p><b>为什么 status 只允许 1 / 2，不允许 0：</b>0 是草稿，而草稿目前没有
 * 创建/续写入口（发布接口一进来就是 1）。放 0 进来等于造出一个
 * 只有状态、没有任何可见路径能再把它变回 1 的中间态
 * （严格说 2→0 也不是草稿语义）。所以这里只认「1 发布 / 2 下架」两个值，
 * 别的都在 Service 里显式拦成参数校验错误。
 */
@Data
public class NoteStatusDTO {

    /** 1 发布（上架） / 2 下架 */
    @NotNull(message = "状态不能为空")
    private Integer status;
}