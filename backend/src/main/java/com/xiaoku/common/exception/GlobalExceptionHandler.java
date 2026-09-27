package com.xiaoku.common.exception;

import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.Result;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.stream.Collectors;

/**
 * 全局异常处理器。
 *
 * <p>核心原则：<b>HTTP 状态码恒为 200，真实结果放在 body.code 里</b>。
 * 这样做的好处是前端只需在 Axios 拦截器里处理一种情况；
 * 代价是失去 HTTP 语义（无法用 404 区分资源不存在），所以错误码必须设计得足够清晰。
 *
 * <p>注意 {@code MethodArgumentNotValidException} 继承自
 * {@code BindException}，两者处理顺序上任意，但建议都保留
 * （前者是 @RequestBody，后者是表单/查询参数）。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 可预期的业务异常：记 warn，不打堆栈。
     * 「用户密码输错」这种是正常业务，不是系统故障，打 ERROR 会淹没真正的错误。
     */
    @ExceptionHandler(BizException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleBizException(BizException e, HttpServletRequest request) {
        log.warn("业务异常 uri={} code={} msg={}", request.getRequestURI(), e.getCode(), e.getMessage());
        return Result.fail(e.getCode(), e.getMessage());
    }

    /**
     * @RequestBody 上的 @Valid 校验失败。
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleMethodArgumentNotValid(MethodArgumentNotValidException e,
                                                     HttpServletRequest request) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("；"));
        log.warn("参数校验失败 uri={} msg={}", request.getRequestURI(), msg);
        return Result.fail(ErrorCodeEnum.PARAM_VALIDATION_ERROR, msg);
    }

    /**
     * 表单 / 查询参数对象上的校验失败。
     */
    @ExceptionHandler(BindException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleBindException(BindException e, HttpServletRequest request) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("；"));
        log.warn("参数绑定失败 uri={} msg={}", request.getRequestURI(), msg);
        return Result.fail(ErrorCodeEnum.PARAM_VALIDATION_ERROR, msg);
    }

    /**
     * 方法参数上的 @NotBlank / @Min 等约束校验失败。
     */
    @ExceptionHandler(ConstraintViolationException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleConstraintViolation(ConstraintViolationException e,
                                                  HttpServletRequest request) {
        String msg = e.getConstraintViolations().stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.joining("；"));
        log.warn("约束校验失败 uri={} msg={}", request.getRequestURI(), msg);
        return Result.fail(ErrorCodeEnum.PARAM_VALIDATION_ERROR, msg);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleMissingParam(MissingServletRequestParameterException e) {
        return Result.fail(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "缺少必要参数：" + e.getParameterName());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return Result.fail(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "参数格式错误：" + e.getName());
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleMethodNotSupported(HttpRequestMethodNotSupportedException e) {
        return Result.fail(ErrorCodeEnum.REQUEST_METHOD_NOT_SUPPORTED);
    }

    @ExceptionHandler(NoHandlerFoundException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleNoHandlerFound(NoHandlerFoundException e) {
        return Result.fail(100404, "接口不存在：" + e.getRequestURL());
    }

    /**
     * Spring 6.1 起，未匹配到任何 Handler 的请求不再抛 NoHandlerFoundException，
     * 而是先被静态资源处理器接走并抛 NoResourceFoundException。
     * 不单独处理的话会被下面的兜底分支吞成「系统繁忙」，前端排查时非常困惑。
     */
    @ExceptionHandler(NoResourceFoundException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleNoResourceFound(NoResourceFoundException e) {
        log.warn("接口不存在：{}", e.getResourcePath());
        return Result.fail(100404, "接口不存在：/" + e.getResourcePath());
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleMaxUploadSize(MaxUploadSizeExceededException e) {
        return Result.fail(ErrorCodeEnum.FILE_UPLOAD_TOO_LARGE);
    }

    /**
     * 唯一索引冲突。
     *
     * <p>这是本项目一个很典型的用法：note_like 表建了
     * {@code uk_user_note(user_id, note_id)}，重复点赞会直接撞唯一索引。
     * 我们<b>不在 Service 层用「先查再插」来防重</b>——那是典型的并发不安全写法，
     * 两个请求同时「查不到」然后同时插入。而是让 DB 兜底，捕获
     * DuplicateKeyException 并翻译成「已经点过赞了」。
     */
    @ExceptionHandler(DuplicateKeyException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleDuplicateKey(DuplicateKeyException e) {
        log.warn("唯一索引冲突：{}", e.getMessage());
        String msg = e.getMessage() == null ? "数据已存在，请勿重复提交" : e.getMessage();
        if (msg.contains("uk_user_note")) {
            return Result.fail(ErrorCodeEnum.ALREADY_LIKED, msg);
        }
        if (msg.contains("uk_user_follow")) {
            return Result.fail(ErrorCodeEnum.ALREADY_FOLLOWED, msg);
        }
        if (msg.contains("uk_username")) {
            return Result.fail(ErrorCodeEnum.USERNAME_ALREADY_EXISTS, msg);
        }
        return Result.fail(ErrorCodeEnum.REPEAT_SUBMIT, msg);
    }

    /**
     * 兜底。必须打完整堆栈，否则线上出问题无从查起。
     * 同时注意：不能把 e.getMessage() 直接回给前端，它常常含 SQL 片段和表结构。
     */
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> handleException(Exception e, HttpServletRequest request) {
        log.error("系统异常 uri={}", request.getRequestURI(), e);
        return Result.fail(ErrorCodeEnum.SYSTEM_ERROR);
    }
}
