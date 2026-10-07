package com.xiaoku.module.notification.enums;

/**
 * 通知类型
 *
 * <p>与 {@code sql/schema.sql} 里 {@code notification.type} 的注释一一对应，
 * 改这里必须同步改那条注释，否则两边对不上，谁都查不出错。
 */
public enum NotificationType {

    /** 赞了我的笔记 —— targetId = noteId */
    NOTE_LIKE(1, "赞了你的笔记"),

    /** 评论了我的笔记 —— targetId = noteId，content = 评论内容 */
    COMMENT(2, "评论了你的笔记"),

    /** 赞了我的评论 —— targetId = commentId */
    COMMENT_LIKE(3, "赞了你的评论"),

    /** 关注了我 —— targetId = 被关注者 userId */
    FOLLOW(4, "关注了你"),

    /** 回复了我的评论 —— targetId = 父评论ID，content = 回复内容 */
    COMMENT_REPLY(5, "回复了你的评论"),

    /**
     * P16 被提及：targetId = noteId，content 为提及我的那句原文
     *
     * <p>与「评论通知」分开而不是复用：两者都是「有人在我名下说了话」，
     * 但入口不同（一个在评论区、一个在正文里 @ 我），通知页的文案与
     * 「去这条笔记」的动作都一样，分开只是为了将来能分别统计。
     */
    MENTION(6, "在笔记里提到了我"),

    /**
     * P18 内容被举报：{@code targetId} = noteId 或 commentId（由 noteId 是否为空区分）
     *
     * <p><b>刻意不告诉作者「是谁举报的」</b>：那等于让举报人暴露，
     * 从此没人敢举报。通知只说「你的内容被举报」，不给举报人身份。
     */
    REPORTED(7, "你的内容被举报");

    private final int code;
    private final String text;

    NotificationType(int code, String text) {
        this.code = code;
        this.text = text;
    }

    public int code() {
        return code;
    }

    /** 列表页展示用的动作短语，如「赞了你的笔记」 */
    public String text() {
        return text;
    }

    public static NotificationType of(int code) {
        for (NotificationType t : values()) {
            if (t.code == code) {
                return t;
            }
        }
        return null;
    }
}