package com.xiaoku.module.topic.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serial;
import java.io.Serializable;

/** 话题引用，只带 id 与名字 —— 详情页要的是「点了能跳过去」 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "话题引用")
public class TopicVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Schema(description = "话题ID")
    private Long id;

    @Schema(description = "话题名，不含 #")
    private String name;
}