package com.xiaoku.module.moderation.enums;

/** 被举报对象类型 */
public enum ReportTargetType {

    /** 笔记 */
    NOTE(1),
    /** 评论 */
    COMMENT(2);

    private final int code;

    ReportTargetType(int code) {
        this.code = code;
    }

    public int code() {
        return code;
    }

    public static ReportTargetType of(int code) {
        for (ReportTargetType t : values()) {
            if (t.code == code) {
                return t;
            }
        }
        return null;
    }
}