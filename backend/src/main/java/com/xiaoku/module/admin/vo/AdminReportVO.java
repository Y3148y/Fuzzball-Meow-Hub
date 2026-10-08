package com.xiaoku.module.admin.vo;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 运营视角的举报记录。
 *
 * <p>关键在于<b>把「被举报内容」和「举报人」都摊平到同一层</b>：
 * 运营处理一条举报时必须同时看到「他举报了什么」和「谁举报的」，
 * 否则要来回查四次库才能下判断。原始 report 表只有 id，
 * 直接返回实体的话前端就得更两次请求拼这些信息 ——
 * 而拼的过程中很容易把「作者昵称」和「举报人昵称」搞反，
 * 把作者当成举报人，处置了错误的人。
 *
 * <p>⚠️ 内容已经不存在时（作者自己删了）对应字段为 null，
 * 这不是 bug —— 运营需要知道「这条举报的对象已经没了」，
 * 于是可以直接驳回而不用再查一遍。
 */
@Data
public class AdminReportVO {

    private Long id;

    /** 1 笔记 2 评论 */
    private Integer targetType;

    private Long targetId;

    /** 1 垃圾广告 2 色情低俗 3 违法违规 4 侵权 5 恶意攻击 6 其他 */
    private Integer reasonCode;

    private String reasonText;

    /** 举报人补充说明 */
    private String detail;

    /** 0 待处理 1 已受理 2 已驳回 */
    private Integer status;

    private String handleNote;

    /** 处置动作 1 驳回 2 下架 3 删除 4 禁言（未处置时为 null） */
    private Integer handleAction;

    /** 举报人昵称（不是作者！） */
    private String reporterNickname;

    private String reporterUsername;

    /* ---------- 被举报内容 ---------- */

    /** 被举报笔记的标题；评论无标题。内容已删除时为 null */
    private String targetTitle;

    /** 被举报内容的作者昵称（不是举报人） */
    private String targetAuthorNickname;

    private Long targetAuthorId;

    /** 评论正文；笔记为 null */
    private String targetContent;

    /** 内容当前是否还存在（false 时运营应当驳回而不是处置） */
    private Boolean targetExists;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime handleTime;
}