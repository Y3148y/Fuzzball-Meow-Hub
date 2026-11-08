package com.xiaoku.module.note.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 视频上传响应（多码率，P48）
 *
 * <p>{@code url} 是<b>默认播放档（最高清晰度）</b>的地址 —— 与旧版
 * {@code {url}} 单字段响应兼容：前端把它直接当 {@code videoUrl} 用，
 * 老语义不变。{@code qualities} 是全部可用档位（含 {@code url} 那档），
 * 降级（ffmpeg 不可用 / 转码失败 / 已达标跳过）时为 null，
 * 表示「只有这一个文件能播」。
 *
 * <p>刻意<b>不带 cover</b>：封面由发布时服务端从 videoUrl 推导
 * （{@code VideoStorage.coverOf}），客户端不需要也无法修改它。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "视频上传结果")
public class VideoUploadVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "默认播放档（最高清晰度）的视频 URL")
    private String url;

    @Schema(description = "全部清晰度档位；null = 单码率（降级或无需转码）")
    private List<VideoQualityVO> qualities;
}
