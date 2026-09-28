package com.xiaoku.module.comment.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "评论")
public class CommentVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "评论ID")
    private Long id;

    @Schema(description = "笔记ID")
    private Long noteId;

    @Schema(description = "评论人昵称")
    private String nickname;

    @Schema(description = "评论人头像")
    private String avatar;

    @Schema(description = "评论内容")
    private String content;

    @Schema(description = "点赞数")
    private Integer likeCount;

    @Schema(description = "父评论ID，null 表示一级评论")
    private Long parentId;

    @Schema(description = "根评论ID，null 表示一级评论")
    private Long rootCommentId;
    @Schema(description = "被回复者昵称，null 表示不是回复")
    private String replyNickname;

    @Schema(description = "当前登录用户是否已点赞")
    private Boolean liked;

    @Schema(description = "是否是自己发的，前端据此显示删除按钮")
    private Boolean mine;

    @Schema(description = "创建时间")
    private LocalDateTime createTime;

    @Schema(description = "子回复列表，只有一级评论会带这个字段")
    private List<CommentVO> replies;

    /**
     * 该一级评论<b>总共</b>有多少条子回复。
     *
     * <p>{@link #replies} 最多只带 {@code MAX_REPLIES_PER_ROOT} 条，
     * 这个字段告诉前端"还有更多"，否则前端只能靠
     * {@code replies.size() < replyTotal} 猜，容易漏判。
     */
    @Schema(description = "子回复总数，可能大于 replies 的长度")
    private Integer replyTotal;
}
