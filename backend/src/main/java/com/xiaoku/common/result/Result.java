package com.xiaoku.common.result;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/**
 * 统一响应体。
 *
 * <p>约定：
 * <ul>
 *     <li>{@code code == 0} 表示业务成功，非 0 均为业务/系统错误</li>
 *     <li>{@code message} 面向前端展示，{@code data} 才是业务数据</li>
 *     <li>任何 Controller 都不允许直接返回裸对象，避免前端适配两套结构</li>
 * </ul>
 *
 * @param <T> 业务数据类型
 */
@Data
// 无参构造器专供 Jackson 反序列化：幂等回放要把缓存下来的响应 JSON
// 还原成 Result 再返回。不能省——下面那个构造器是 private 且带参，
// Jackson 没有参数名模块时建不出实例（会报 no suitable constructor）。
// 顺带一提，回放值必须能赋给控制器的声明返回类型：Spring 用的是
// CGLIB 类代理，生成的方法体里有一句 return (Result) advice的返回值，
// 所以回放时返回 Map 会在代理里抛 ClassCastException，不是消息转换器的事。
@NoArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Result<T> implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /** 业务状态码，0 = 成功 */
    private int code;

    /** 提示信息 */
    private String message;

    /** 业务数据 */
    private T data;

    private Result(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    public static <T> Result<T> success() {
        return new Result<>(ErrorCodeEnum.SUCCESS.getCode(), ErrorCodeEnum.SUCCESS.getMessage(), null);
    }

    public static <T> Result<T> success(T data) {
        return new Result<>(ErrorCodeEnum.SUCCESS.getCode(), ErrorCodeEnum.SUCCESS.getMessage(), data);
    }

    public static <T> Result<T> fail(ErrorCodeEnum errorCodeEnum) {
        return new Result<>(errorCodeEnum.getCode(), errorCodeEnum.getMessage(), null);
    }

    public static <T> Result<T> fail(ErrorCodeEnum errorCodeEnum, String message) {
        return new Result<>(errorCodeEnum.getCode(), message, null);
    }

    public static <T> Result<T> fail(int code, String message) {
        return new Result<>(code, message, null);
    }

    /**
     * 仅供 GlobalExceptionHandler 兜底使用。
     */
    public static <T> Result<T> error() {
        return new Result<>(ErrorCodeEnum.SYSTEM_ERROR.getCode(), ErrorCodeEnum.SYSTEM_ERROR.getMessage(), null);
    }

    /**
     * 判断响应是否成功。
     *
     * <p>之所以放在实体上而不是工具类，是因为调用方写 {@code result.isSuccess()} 比
     * {@code ErrorCodeEnum.SUCCESS.getCode() == result.getCode()} 直观得多。
     *
     * <p>{@code @JsonIgnore} 不可省：Lombok 的 {@code @Data} 会把这个 getter 也算成属性，
     * 导致序列化结果里多出一个前端用不上的 {@code "success": true} 字段。
     */
    @JsonIgnore
    public boolean isSuccess() {
        return this.code == ErrorCodeEnum.SUCCESS.getCode();
    }
}
