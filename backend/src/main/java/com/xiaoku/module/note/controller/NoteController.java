package com.xiaoku.module.note.controller;

import com.xiaoku.common.annotation.Idempotent;
import com.xiaoku.common.annotation.RateLimit;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.common.result.Result;
import com.xiaoku.module.note.dto.NotePublishDTO;
import com.xiaoku.module.note.service.NoteInteractionService;
import com.xiaoku.module.note.service.NoteQueryService;
import com.xiaoku.module.note.service.NoteService;
import com.xiaoku.module.note.vo.NoteListItemVO;
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
    // 写接口按登录用户限流：一个人一天发几百篇要么是机器人，要么是刷屏，
    // 两种都不该占用索引和搜索资源。按 userId 而非 IP 是为了让「换设备继续发」也被算进来。
    @RateLimit(count = 20, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "发布太频繁啦，1 分钟内最多 20 篇")
    // 弱网重发是「一篇笔记发两遍」的主要来源；同一个 X-Idempotency-Key 重发只会拿到同一个 noteId
    @Idempotent
    @PostMapping("/publish")
    public Result<NoteVO> publish(@RequestBody @Valid NotePublishDTO dto) {
        return Result.success(noteService.publish(dto));
    }

    @Operation(summary = "上传单张图片",
            description = "multipart/form-data，字段名 file。仅支持 jpg/png/webp/gif，单张不超过 10MB")
    // 上传是唯一会吃磁盘和带宽的接口，阈值给得比发布更紧
    @RateLimit(count = 30, seconds = 60, dimension = RateLimit.Dimension.USER,
            message = "上传太频繁啦，1 分钟内最多 30 张")
    // 上传重试会多出一个孤儿文件（图片已落盘，笔记却没引用它），
    // 幂等让重试拿回同一个 URL，不会越传越多
    @Idempotent
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

    @Operation(summary = "某用户的笔记列表",
            description = "作者主页用：只返回已发布笔记，按发布时间倒序分页")
    @GetMapping("/user/{userId}")
    public Result<PageVO<NoteListItemVO>> userNotes(
            @Parameter(description = "作者ID") @PathVariable Long userId,
            @Parameter(description = "页码，从 1 开始") @RequestParam(defaultValue = "1") long page,
            @Parameter(description = "每页条数") @RequestParam(defaultValue = "20") long size) {
        int safeSize = (int) Math.min(Math.max(size, 1L), 100L);
        int safePage = (int) Math.max(page, 1L);
        return Result.success(noteQueryService.pageUserNotes(userId, safePage, safeSize));
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
