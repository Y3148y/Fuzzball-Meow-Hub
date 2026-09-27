package com.xiaoku.controller;

import com.xiaoku.common.result.Result;
import com.xiaoku.common.util.SnowflakeIdGenerator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.Data;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;

/**
 * P0 骨架自检接口。
 *
 * <p>存在的意义：让 P0 一开始就能肉眼验证「Spring 上下文 + 雪花算法 + 配置注入」这条链路
 * 是通的，后续每个阶段做完后也顺手打一下，避免攒到 P9 才发现基础环境有问题。
 */
@Tag(name = "00-系统自检", description = "用于验证服务是否正常，P0 阶段使用")
@RestController
@RequestMapping("/api/system")
public class SystemController {

    private final SnowflakeIdGenerator snowflakeIdGenerator;

    @Value("${spring.application.name}")
    private String applicationName;

    @Value("${xiaoku.snowflake.machine-id:1}")
    private long machineId;

    public SystemController(SnowflakeIdGenerator snowflakeIdGenerator) {
        this.snowflakeIdGenerator = snowflakeIdGenerator;
    }

    @Operation(summary = "健康检查", description = "连续调用两次，验证雪花 ID 单调递增且结构可解析")
    @GetMapping("/ping")
    public Result<PingVO> ping() {
        long id = snowflakeIdGenerator.nextId();
        PingVO vo = new PingVO();
        vo.setApplicationName(applicationName);
        vo.setMachineId(machineId);
        vo.setSnowflakeId(id);
        vo.setSnowflakeParsed(SnowflakeIdGenerator.parse(id));
        vo.setServerTime(LocalDateTime.now());
        return Result.success(vo);
    }

    @Data
    public static class PingVO {
        private String applicationName;
        private long machineId;
        private long snowflakeId;
        private String snowflakeParsed;
        private LocalDateTime serverTime;
    }
}
