package com.xiaoku.module.admin.enums;

import com.xiaoku.module.moderation.entity.ReportEntity;

/**
 * 举报处置动作。
 *
 * <p>刻意做成「动作」枚举而不是让调用方直接传 {@code status}：
 * 处置动作与结果状态是多对一的（驳回 / 下架 / 删除 / 禁言 都把举报标成
 * 「已受理」），让运营自己去想「下架之后这条举报该标成什么状态」是
 * 把两件事混成一件，而且必然会有人填错。
 */
public enum ReportAction {

    /** 1 驳回：认为举报不成立。只改举报状态，不碰内容 */
    REJECT(1, ReportEntity.STATUS_REJECTED, "举报不成立"),

    /** 2 下架笔记：内容下线但保留（作者可以自己改好再上架） */
    TAKE_DOWN_NOTE(2, ReportEntity.STATUS_ACCEPTED, "笔记已下架"),

    /** 3 删除笔记：内容级联删除，不可恢复 */
    DELETE_NOTE(3, ReportEntity.STATUS_ACCEPTED, "笔记已删除"),

    /** 4 禁用作者：账号级处置，用于「这个人反复发违规内容」 */
    BAN_AUTHOR(4, ReportEntity.STATUS_ACCEPTED, "作者已被禁用");

    private final int code;
    private final int resultStatus;
    private final String text;

    ReportAction(int code, int resultStatus, String text) {
        this.code = code;
        this.resultStatus = resultStatus;
        this.text = text;
    }

    public int code() {
        return code;
    }

    public int resultStatus() {
        return resultStatus;
    }

    public String text() {
        return text;
    }

    /** 只作用于笔记内容的动作（评论没有「下架」这个状态） */
    public boolean affectsNote() {
        return this == TAKE_DOWN_NOTE || this == DELETE_NOTE;
    }

    public static ReportAction of(Integer code) {
        if (code == null) {
            return null;
        }
        for (ReportAction a : values()) {
            if (a.code == code) {
                return a;
            }
        }
        return null;
    }
}