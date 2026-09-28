package com.xiaoku.module.note.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

/**
 * 发布笔记请求。
 *
 * <p><b>图片为什么不和正文一起提交？</b>
 * 因为图片要先单独上传换 URL（走 {@code POST /api/note/image}），
 * 再把 URL 列表带到这里。一次性 multipart 提交正文+多图的问题是：
 * 图片存了一半失败时，已经写入的孤儿文件没法回滚。
 * 分两步则可以把「上传」与「发布」解耦，用户重试发布不必重传图片。
 */
@Data
public class NotePublishDTO {

    @NotBlank(message = "标题不能为空")
    @Size(max = 64, message = "标题不能超过 64 字")
    private String title;

    @NotBlank(message = "正文不能为空")
    @Size(max = 2000, message = "正文不能超过 2000 字")
    private String content;

    /** 1 图文 2 视频，默认图文 */
    private Integer type = 1;

    /**
     * 图片 URL 列表，由 /api/note/image 预先换取。
     *
     * <p><b>刻意不加 {@code @Size(max = 9)}：</b>那样会先抛 100001 参数校验错误，
     * 把 {@code NOTE_IMAGE_LIMIT_EXCEED(20004)} 这个专用错误码架空。
     * 数量上限在 Service 里显式检查，语义才是「图片超限」而不是「参数非法」。
     */
    private List<String> imageUrls;

    /** type=2 时必填 */
    private String videoUrl;
}
