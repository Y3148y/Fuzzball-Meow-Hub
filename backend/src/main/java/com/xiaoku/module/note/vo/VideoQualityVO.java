package com.xiaoku.module.note.vo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 视频清晰度档位（多码率，P48）
 *
 * <p>转码出来的每一个变体对应一条：{@code label}（如 720p / 480p）、
 * {@code url}（可直接访问站点路径）、{@code width} / {@code height}（画面尺寸）。
 *
 * <p><b>一条数据三种角色</b>：DTO（前端把上传接口返回的档位原样带回发布）、
 * VO（详情 / 沉浸流返回给播放器）、JSON 行（{@code note.video_qualities} 列）。
 * 合成一类是刻意的 —— 三处字段形状完全一致，拆三类只会做出三个互相
 * copy 的样板类，而「加一个字段要改三处」的漂移成本更高。
 *
 * <p><b>width / height 用 Integer 而不是 Long</b>：项目把 Long 全局序列化成
 * 字符串（雪花 ID 精度保护，{@code JacksonConfig}），但这两个字段是像素数，
 * 前端要算进度条与画布比例，拿 {@code "720"} 字符串会坏事 —— 同
 * {@code PageVO.total} 改 Integer 是同一条教训。
 */
@Slf4j
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "视频清晰度档位")
public class VideoQualityVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "档位名，如 720p / 480p")
    private String label;

    @Schema(description = "该档位视频的站点路径")
    private String url;

    @Schema(description = "画面宽（像素）")
    private Integer width;

    @Schema(description = "画面高（像素）")
    private Integer height;

    /**
     * 档位列表 → 存入 {@code note.video_qualities} 的 JSON 字符串。
     *
     * <p>null / 空表 → {@code null}（列上没有内容 = 单码率原文件）。
     * 序列化失败返回 null 并 WARN：落成 null 只是退回单码率播放，
     * 不该为一个展示字段让整个发布失败。
     */
    public static String serialize(ObjectMapper mapper, List<VideoQualityVO> list) {
        if (mapper == null || list == null || list.isEmpty()) {
            return null;
        }
        try {
            return mapper.writeValueAsString(list);
        } catch (Exception e) {
            log.warn("视频清晰度列表序列化失败，落库为单码率：{}", e.getMessage());
            return null;
        }
    }

    /**
     * {@code note.video_qualities} 的 JSON → 档位列表。
     *
     * <p>解析失败返回 null（等于单码率）：坏数据不该让详情页 500，
     * 而且老数据 / 裸数据里本来就可能出现脏 JSON。
     */
    public static List<VideoQualityVO> parse(ObjectMapper mapper, String json) {
        if (mapper == null || json == null || json.isBlank()) {
            return null;
        }
        try {
            return mapper.readValue(json, new TypeReference<List<VideoQualityVO>>() {
            });
        } catch (Exception e) {
            log.warn("视频清晰度列表解析失败，按单码率处理 json={}：{}", json, e.getMessage());
            return null;
        }
    }
}
