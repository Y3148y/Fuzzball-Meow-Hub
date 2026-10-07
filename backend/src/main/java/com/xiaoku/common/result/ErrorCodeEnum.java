package com.xiaoku.common.result;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 全局错误码。
 *
 * <p>分段规则（面试可讲：为什么不按 HTTP 状态码分？）：
 * <pre>
 *   0          成功
 *   10xxx      用户 / 认证域
 *   20xxx      笔记域
 *   30xxx      互动域（点赞 / 收藏 / 评论）
 *   40xxx      关注域
 *   50xxx      搜索 / 消息域
 *   1xxxx      系统与基础设施
 * </pre>
 *
 * <p>刻意不使用 HTTP 语义（400/401/404...）作为业务码，原因是业务失败要用 HTTP 200
 * 兜住（前端 Axios 拦截器按 2xx 判定，不会因为业务失败直接抛错），
 * 这样业务码和传输层状态码职责分离，语义更清晰。
 */
@Getter
@AllArgsConstructor
public enum ErrorCodeEnum {

    SUCCESS(0, "操作成功"),

    /* ---------------- 用户 / 认证 10xxx ---------------- */
    USER_NOT_FOUND(10001, "用户不存在"),
    USERNAME_OR_PASSWORD_ERROR(10002, "用户名或密码错误"),
    USERNAME_ALREADY_EXISTS(10003, "用户名已被占用"),
    PHONE_ALREADY_EXISTS(10004, "手机号已注册"),
    UNAUTHORIZED(10005, "未登录或登录已过期"),
    TOKEN_INVALID(10006, "凭证无效，请重新登录"),
    USER_DISABLED(10007, "账号已被禁用"),

    /* ---------------- 笔记 20xxx ---------------- */
    NOTE_NOT_FOUND(20001, "笔记不存在或已被删除"),
    NOTE_STATUS_ILLEGAL(20002, "当前笔记状态不允许该操作"),
    NOTE_UPLOAD_FAILED(20003, "图片上传失败"),
    NOTE_IMAGE_LIMIT_EXCEED(20004, "单篇笔记最多上传 9 张图片"),

    /* ---------------- 互动 30xxx ---------------- */
    ALREADY_LIKED(30001, "已经点过赞了"),
    NOT_LIKED_YET(30002, "尚未点赞，无法取消"),
    ALREADY_COLLECTED(30003, "已经收藏过了"),
    NOT_COLLECTED_YET(30004, "尚未收藏，无法取消"),
    COMMENT_NOT_FOUND(30005, "评论不存在"),
    COMMENT_CONTENT_EMPTY(30006, "评论内容不能为空"),
    CANNOT_COMMENT_SELF_NOTE(30007, "不能评论自己的笔记"),

    /* ---------------- 关注 40xxx ---------------- */
    ALREADY_FOLLOWED(40001, "已经关注过该用户了"),
    NOT_FOLLOWED_YET(40002, "尚未关注，无法取关"),
    CANNOT_FOLLOW_SELF(40003, "不能关注自己"),

    /* ---------------- 搜索 50xxx ---------------- */
    SEARCH_SERVICE_ERROR(50001, "搜索服务暂不可用"),
    SEARCH_KEYWORD_EMPTY(50002, "搜索关键词不能为空"),

    /**
     * P15 内容审核：命中敏感词
     *
     * <p>用 6 开头是因为它属于「内容合规」这一类，与 1参数 / 3笔记 / 4关注 / 5搜索
     * 都不同组，便于网关按前缀做统一处置。
     *
     * <p>message 里**不回显命中的具体词** —— 告诉用户「你哪个词被禁了」等于给了
     * 绕过办法（换个同义词就行）。要提示具体词只能走审核后台。
     */
    CONTENT_SENSITIVE(60001, "内容包含不允许发布的词，请修改后再试"),

    /**
     * P16 话题
     *
     * <p>话题页面对不存在的名字**必须报错而不是返回空列表**：空列表在页面上
     * 长得和「这个话题还没有笔记」一模一样，用户会以为自己被吞了内容，
     * 而真实原因是拼错了名字。
     */
    TOPIC_NOT_FOUND(70001, "话题不存在"),

    /* ---------------- 系统 1xxxx ---------------- */
    PARAM_VALIDATION_ERROR(100001, "参数校验失败"),
    REQUEST_METHOD_NOT_SUPPORTED(100002, "请求方法不支持"),
    FILE_UPLOAD_TOO_LARGE(100003, "上传文件超过大小限制"),
    REPEAT_SUBMIT(100004, "请勿重复提交"),
    RATE_LIMITED(100005, "操作过于频繁，请稍后再试"),
    SYSTEM_ERROR(100999, "系统繁忙，请稍后再试");

    private final int code;
    private final String message;
}
