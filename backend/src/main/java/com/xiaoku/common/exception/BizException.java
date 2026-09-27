package com.xiaoku.common.exception;

import com.xiaoku.common.result.ErrorCodeEnum;
import lombok.Getter;

import java.io.Serial;

/**
 * 业务异常。
 *
 * <p>约定：能被用户感知的失败一律抛业务异常，由 GlobalExceptionHandler 兜住并转成
 * Result.fail；不可预期的失败让原始异常继续往上抛，避免把内部细节（SQL 片段、堆栈）
 * 泄漏到响应体里。
 */
@Getter
public class BizException extends RuntimeException {

    @Serial
    private static final long serialVersionUID = 1L;

    private final int code;

    public BizException(ErrorCodeEnum errorCodeEnum) {
        super(errorCodeEnum.getMessage());
        this.code = errorCodeEnum.getCode();
    }

    public BizException(ErrorCodeEnum errorCodeEnum, String message) {
        super(message);
        this.code = errorCodeEnum.getCode();
    }

    public BizException(int code, String message) {
        super(message);
        this.code = code;
    }

    /**
     * 抛出业务异常的前置断言，减少 if-throw 样板代码。
     */
    public static void throwIf(boolean condition, ErrorCodeEnum errorCodeEnum) {
        if (condition) {
            throw new BizException(errorCodeEnum);
        }
    }

    public static void throwIf(boolean condition, ErrorCodeEnum errorCodeEnum, String message) {
        if (condition) {
            throw new BizException(errorCodeEnum, message);
        }
    }
}
