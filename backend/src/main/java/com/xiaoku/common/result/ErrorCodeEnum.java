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

    /* ---------------- 私信 5xxxx（与搜索同段：都是「人和信息」的检索/送达） ---------------- */
    /**
     * P22 私信
     *
     * <p>复用 5xxxx 段而不是新开一段：这个段位的注释原本就写着「搜索 / 消息域」，
     * 而私信正是那个「消息」的后一半。
     */
    CANNOT_MESSAGE_SELF(50003, "不能给自己发私信"),
    /**
     * 不能发给被拉黑的人
     *
     * <p>message 刻意**不区分是谁拉黑了谁**（「你已被对方拉黑」/「请先解除拉黑」
     * 都不行）：P18 已经定过这个原则 —— 把对方的操作暴露出去，
     * 会把普通屏蔽变成社交对抗。消息发不出去这个结果无法隐藏（否则前端会以为
     * 发送成功），但「知道对方在屏蔽我」这条信息是可以不主动给的。
     */
    MESSAGE_TARGET_BLOCKED(50004, "消息发送失败"),
    /** 会话不存在 = 两人从来没有过往来（**与被拉黑刻意同码**，理由见 MESSAGE_TARGET_BLOCKED） */
    MESSAGE_SESSION_NOT_FOUND(50005, "会话不存在"),
    /** 雪花 ID 撞了导致会话行插不出来。极罕见，但要有可诊断的码而不是让后面 NPE */
    MESSAGE_SEND_FAILED(50006, "消息发送失败，请重试"),

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
     * P18 举报与黑名单
     *
     * <p>用8 开头（内容治理段），与 6xxxx 的审核分开：审核拦的是「**机器判定**
     * 违规」，举报处理的是「**人举报**」，运营后台要分开看这两类。
     */
    ALREADY_REPORTED(80003, "你已经举报过这条内容，我们会尽快处理"),
    CANNOT_REPORT_SELF(80004, "不能举报自己的内容"),
    ALREADY_BLOCKED(80005, "已经拉黑过了"),
    NOT_BLOCKED_YET(80006, "尚未拉黑，无需取消"),
    CANNOT_BLOCK_SELF(80007, "不能拉黑自己"),

    /**
     * P16 话题
     *
     * <p>话题页面对不存在的名字**必须报错而不是返回空列表**：空列表在页面上
     * 长得和「这个话题还没有笔记」一模一样，用户会以为自己被吞了内容，
     * 而真实原因是拼错了名字。
     */
    TOPIC_NOT_FOUND(70001, "话题不存在"),

    /**
     * P20 运营管理后台
     *
     * <p>用 9 开头（管理段），与 8xxxx 的「内容治理」分开：8xxxx 是**用户能触发**的
     * 动作（我举报了 / 我拉黑了），9xxxx 是**只有运营能触发**的动作。
     * 分段之后网关与日志可以按前缀分开统计 —— 用户侧举报激增和
     * 运营侧越权尝试是完全不同的两件事，混在一个段位里看不出区别。
     *
     * <p>「需要管理员权限」单独给一个码而不是复用 10005（未登录）：
     * 两者要分开告警 —— 未登录是流量问题，一片 10005 说明有人在撞；
     * 已登录却不是管理员说明有账号被提权错了，那是**安全事件**。
     */
    FORBIDDEN_NOT_ADMIN(90001, "需要管理员权限"),
    REPORT_NOT_FOUND(90002, "举报不存在"),
    /** 已处置过的举报不能再处置：处置动作不可重放（尤其是「删笔记」） */
    REPORT_ALREADY_HANDLED(90003, "该举报已处理"),
    CANNOT_DISABLE_SELF(90004, "不能禁用自己的账号"),
    CANNOT_DISABLE_ADMIN(90005, "不能禁用管理员账号"),
    /** 账号被运营禁用。登录与写操作都返这个码 */
    USER_BANNED(90006, "账号已被禁用，请联系管理员"),
    ADMIN_TARGET_NOT_FOUND(90007, "目标不存在"),

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
