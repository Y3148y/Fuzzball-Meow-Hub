package com.xiaoku.module.admin.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 运营视角的笔记行。
 *
 * <p>与 {@code NoteListItemVO}（给用户看的列表卡）的区别：
 * 这里<b>不需要</b> authorFollowed / liked 这类「和当前浏览者的关系」字段 ——
 * 运营不是读者，关系字段对他没有意义。带了反而是噪音：
 * 任何一处「关系」的组装逻辑出错都会污染这张表，而这张表的唯一读者是运营。
 */
@Data
public class AdminNoteItemVO {

    private Long id;

    private Long authorId;

    private String authorNickname;

    private String authorUsername;

    private String title;

    /** 正文截断到 100 字：运营要判断违规只需要看开头，长文不必全量传 */
    private String content;

    /** 1 图文 2 视频 */
    private Integer type;

    /** 0 草稿 1 发布 2 下架 */
    private Integer status;

    private String cover;

    private String videoUrl;

    private Integer likeCount;

    private Integer collectCount;

    private Integer commentCount;

    /** 该笔记被举报的次数（未处理 + 已处理合计） */
    private Integer reportCount;

    private LocalDateTime createTime;
}