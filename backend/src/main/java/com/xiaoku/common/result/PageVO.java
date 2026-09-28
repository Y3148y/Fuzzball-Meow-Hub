package com.xiaoku.common.result;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 统一分页返回体。
 *
 * <p>P5 之前项目里没有分页，趁这个机会定一个约定，避免每个列表接口
 * 各造一个 {@code {list, total, page}} 导致前端到处适配。
 *
 * <p>刻意<b>不返 {@code pages}</b>（总页数）：它永远等于
 * {@code ceil(total / size)}，属于可推导的冗余字段，
 * 前端两个数一除就有了，多返一个字段就多一处可能对不上的地方。
 *
 * <p><b>为什么 total / page / size 用 {@code Integer} 而不是 {@code long}？</b>
 * {@code JacksonConfig} 会把所有 {@code Long} 序列化成字符串（因为雪花 ID
 * 有 10^17，JS 的 number 存不下）。但这三个字段是<b>计数</b>不是 ID，
 * 序列化成 {@code "1"} 会让前端 {@code page === 1} 判断恒为 false，
 * 而把它们转成 number 又在 64 位下有溢出风险——所以直接用 Integer，
 * 让它们保持 JSON number。和 {@code LoginVO.expiresIn} 改 Integer 是同一个理由。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "分页结果")
public class PageVO<T> implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "当前页数据")
    private List<T> list;

    @Schema(description = "总条数")
    private Integer total;

    @Schema(description = "当前页码，从 1 开始")
    private Integer page;

    @Schema(description = "每页条数")
    private Integer size;

    /**
     * 由 MyBatis-Plus 的 IPage 转换。
     *
     * <p>{@code total} 用 {@code Math.toIntExact} 而不是 {@code (int)} 强转：
     * MyBatis-Plus 的 IPage.total 是 long，强转会静默截断，
     * 而 toIntExact 超范围会直接抛异常——总条数超过 21 亿在评论表上不可能发生，
     * 真发生了说明有 bug，静默截断会变成"总数 0"这种极难查的现象。
     */
    public static <T> PageVO<T> of(List<T> list, long total, int page, int size) {
        return PageVO.<T>builder()
                .list(list)
                .total(Math.toIntExact(total))
                .page(page)
                .size(size)
                .build();
    }
}
