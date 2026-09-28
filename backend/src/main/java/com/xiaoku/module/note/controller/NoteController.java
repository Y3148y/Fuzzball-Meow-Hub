package com.xiaoku.module.note.controller;

import com.xiaoku.common.result.Result;
import com.xiaoku.module.note.dto.NotePublishDTO;
import com.xiaoku.module.note.service.NoteInteractionService;
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
    private final NoteInteractionService interactionService;

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

    @Operation(summary = "笔记详情", description = "含图片列表、作者信息、是否已点赞与是否已收藏")
    @GetMapping("/{id}")
    public Result<NoteVO> detail(@Parameter(description = "笔记ID") @PathVariable Long id) {
        return Result.success(noteQueryService.getDetail(id));
    }

    // ------------------------------------------------------------------
    // 点赞 / 收藏
    //
    // 用 PUT / DELETE 而不是 POST /like + POST /unlike：
    // 这四个操作是幂等的，语义上就是"把某状态置为 true/false"，
    // PUT/DELETE 把这个意图写进了方法名，前端重试也不会出错。
    // ------------------------------------------------------------------

    @Operation(summary = "点赞", description = "重复点赞返回 30001")
    @PutMapping("/{id}/like")
    public Result<NoteVO> like(@Parameter(description = "笔记ID") @PathVariable Long id) {
        return Result.success(interactionService.like(id));
    }

    @Operation(summary = "取消点赞", description = "未点赞时取消返回 30002")
    @DeleteMapping("/{id}/like")
    public Result<NoteVO> unlike(@Parameter(description = "笔记ID") @PathVariable Long id) {
        return Result.success(interactionService.unlike(id));
    }

    @Operation(summary = "收藏", description = "重复收藏返回 30003")
    @PutMapping("/{id}/collect")
    public Result<NoteVO> collect(@Parameter(description = "笔记ID") @PathVariable Long id) {
        return Result.success(interactionService.collect(id));
    }

    @Operation(summary = "取消收藏", description = "未收藏时取消返回 30004")
    @DeleteMapping("/{id}/collect")
    public Result<NoteVO> uncollect(@Parameter(description = "笔记ID") @PathVariable Long id) {
        return Result.success(interactionService.uncollect(id));
    }
}
