package com.xiaoku.module.note.dto;

import com.xiaoku.module.note.vo.VideoQualityVO;
import io.swagger.v3.oas.annotations.media.Schema;
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

    /**
     * P50 起不再 {@code @NotBlank}：草稿允许只写标题（正文空着）。
     * 「正文非空」改由 Service 按状态分支校验 —— 直接发布、编辑已发布/已下架的
     * 笔记必须带正文；存草稿、编辑草稿允许为空。放 DTO 注解的话两条路径
     * 没法区分，注解是无条件生效的。
     */
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

    /**
     * 视频清晰度档位（P48 多码率），由 {@code POST /api/note/video} 返回后
     * 原样随发布提交。Service 校验后序列化进 {@code note.video_qualities}。
     *
     * <p>刻意的<b>服务端校验、DTO 不加注解</b>（与 {@code imageUrls} 同一条规矩）：
     * 「档位超 3 个」这类业务上限要有自己的语义，被 100001 的参数校验
     * 抢先拦掉反而看不清是谁挡的。
     */
    private List<VideoQualityVO> videoQualities;

    /**
     * 正文 @ 了谁（用户ID列表，P30）
     *
     * <p><b>为什么不用服务端解析文本</b>：昵称允许重复，解析文本必须在重名时
     * 挑一个，而挑错人比不 @ 更糟。详见 {@code CommentCreateDTO.mentionUserIds}
     * 的注释，两条链路共用同一套理由。
     */
    @Schema(description = "正文 @ 了谁（用户ID列表；正文里的 @ 只是外观，这里才是事实）")
    @Size(max = 10, message = "一篇笔记最多 @ 10 个人")
    private List<String> mentionUserIds;

    /**
     * P50 草稿：0 = 存草稿。null / 1 = 直接发布（既有行为不变）。
     *
     * <p><b>只在 POST /api/note 上有意义；PUT /api/note/{id}（编辑）忽略此字段</b>
     * —— 编辑不改变状态：草稿编辑后仍是草稿，已发布的编辑后仍是已发布，
     * 状态变更只有 PUT /api/note/{id}/status 一条路。同一个字段在两个端点上
     * 语义不同是陷阱，所以编辑端点对它**显式忽略**而不是顺手生效，
     * 避免出现「编辑草稿时误传 status=1 就悄悄发布了」这种静默行为。
     *
     * <p>其它取值一律 100001。草稿允许无图（type=1 时 imageUrls 可空），
     * 发布（0→1 或直接 1）时才要求图文必带图 —— P21 那条规则只管「成为发布的笔记」。
     */
    @Schema(description = "0=存草稿；null/1=发布。仅创建接口有效，编辑接口忽略")
    private Integer status;
}
