package com.xiaoku.module.note.controller;

import com.xiaoku.common.result.Result;
import com.xiaoku.module.note.dto.NotePublishDTO;
import com.xiaoku.module.note.service.NoteQueryService;
import com.xiaoku.module.note.service.NoteService;
import com.xiaoku.module.note.vo.NoteVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * 笔记模块接口。
 */
@Tag(name = "02-笔记模块", description = "发布、图片上传、笔记详情")
@RestController
@RequestMapping("/api/note")
@RequiredArgsConstructor
public class NoteController {

    private final NoteService noteService;
    private final NoteQueryService noteQueryService;

    @Operation(summary = "发布笔记",
            description = "图文笔记最多 9 张图；图片需先调 /api/note/image 换取 URL 再随本请求提交")
    @PostMapping("/publish")
    public Result<NoteVO> publish(@RequestBody @Valid NotePublishDTO dto) {
        return Result.success(noteService.publish(dto));
    }

    @Operation(summary = "上传单张图片",
            description = "multipart/form-data，字段名 file。仅支持 jpg/png/webp/gif，单张不超过 10MB")
    @PostMapping("/image")
    public Result<Map<String, String>> uploadImage(
            @Parameter(description = "图片文件", required = true)
            @RequestParam("file") MultipartFile file) {
        return Result.success(Map.of("url", noteService.uploadImage(file)));
    }

    @Operation(summary = "笔记详情", description = "含图片列表、作者信息与是否已点赞")
    @GetMapping("/{id}")
    public Result<NoteVO> detail(@Parameter(description = "笔记ID") @PathVariable Long id) {
        return Result.success(noteQueryService.getDetail(id));
    }
}
