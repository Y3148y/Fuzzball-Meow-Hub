package com.xiaoku.module.topic.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/** 话题列表项 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "话题列表项")
public class TopicListVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "话题ID")
    private Long id;

    @Schema(description = "话题名，不含 #")
    private String name;

    @Schema(description = "话题简介")
    private String description;

    @Schema(description = "该话题下的已发布笔记数（实时算，不落库）")
    private Integer noteCount;
}