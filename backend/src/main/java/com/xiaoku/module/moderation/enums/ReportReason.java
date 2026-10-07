package com.xiaoku.module.moderation.enums;

/**
 * 举报原因
 *
 * <p><b>用固定枚举而不是自由文本</b>：自由文本无法统计（「垃圾广告」比
 * 「色情低俗」多几倍才能决定要不要加词），也无法在举报弹窗里做成
 * 一排可点的选项让用户选 —— 而「让用户选」正是举报转化率的关键：
 * 让人手写一段话，多数人会直接放弃。
 *
 * <p>顺序即展示顺序，按「用户最可能选」排前面。
 */
public enum ReportReason {

    SPAM(1, "垃圾广告"),
    PORN(2, "色情低俗"),
    ILLEGAL(3, "违法违规"),
    INFRINGEMENT(4, "侵权"),
    ABUSE(5, "恶意攻击"),
    OTHER(6, "其他");

    private final int code;
    private final String text;

    ReportReason(int code, String text) {
        this.code = code;
        this.text = text;
    }

    public int code() {
        return code;
    }

    /** 举报弹窗上的按钮文案 */
    public String text() {
        return text;
    }

    public static ReportReason of(int code) {
        for (ReportReason r : values()) {
            if (r.code == code) {
                return r;
            }
        }
        return null;
    }
}