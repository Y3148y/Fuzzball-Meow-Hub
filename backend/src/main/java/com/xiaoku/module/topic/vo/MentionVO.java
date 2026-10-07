package com.xiaoku.module.topic.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/**
 * 被提及的用户
 *
 * <p>只带 id 与昵称：详情页要把正文里的 {@code @昵称} 渲染成可点链接，
 * 有了 id 就能跳到 {@code /user/{id}}，有了昵称能在正文里高亮出对应片段。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "被提及的用户")
public class MentionVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "被提及的用户ID")
    private Long id;

    @Schema(description = "被提及者昵称")
    private String nickname;

    /**
     * 被提及者的**用户名**
     *
     * <p><b>为什么昵称和用户名都要给</b>：正文里写的是 {@code @xk_ui_follow}
     * （用户名），而页面上要显示的是昵称「关注搭子」。前端要靠这段文字定位
     * 正文里的那一片并把它变成链接，必须两个都拿到 ——
     * 只给昵称的话，前端拿昵称去正文里找不到 @{用户名}，
     * 于是 @提及 渲染成纯文本，而**界面看不出任何异常**。
     */
    @Schema(description = "被提及者用户名")
    private String username;
}