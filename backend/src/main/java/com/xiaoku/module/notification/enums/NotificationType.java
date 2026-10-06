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
    COMMENT_REPLY(5, "回复了你的评论");

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