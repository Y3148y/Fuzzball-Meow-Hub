package com.xiaoku.common.storage;

import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * 视频存储
 *
 * <p>与 {@link ImageStorage} 并列而不是共用一个接口：两者的**约束完全不同** ——
 * 图片是 10MB 内、数量受限（9 张/篇），视频是几十上百 MB、每篇一个。
 * 共用一个接口就得在每个方法里问「这次是图还是视频」，那是把调用方的
 * 类型信息藏进实现里。
 *
 * <p>P48 起一次上传可能产生<b>多个文件</b>（多码率变体 + 抽帧封面），
 * 所以 {@link #store} 返回 {@link Stored} 整包而不是单 URL；
 * {@code url} 仍是「默认播放档」地址，老调用方的语义不变。
 */
public interface VideoStorage {

    /** 一个清晰度档位。放 storage 层的自有 record：common 层不依赖 module 层的 vo */
    record Quality(String label, String url, int width, int height) {
    }

    /** store 的产物：默认档地址 + 可选封面 + 全部档位（降级时 qualities 为空表） */
    record Stored(String url, String coverUrl, List<Quality> qualities) {
    }

    /**
     * 存一个视频（转码出多码率档位 + 抽封面），返回整包产物
     *
     * @throws com.xiaoku.common.exception.BizException 类型不支持 / 超大 / 落盘失败
     */
    Stored store(MultipartFile file);

    /**
     * 按视频 URL 反查它对应的封面 URL（找不到返回 null）
     *
     * <p>发布/编辑从 {@code videoUrl} 推导 {@code note.cover} 时用：
     * 带磁盘存在性检查，降级（没转码、没封面）返回 null，
     * 让列表卡落到吉祥物兜底，而不是挂一张 404 图。
     */
    default String coverOf(String videoUrl) {
        return null;
    }

    /**
     * 删一个视频（按 URL）
     *
     * <p>删失败只记日志：笔记已经删了，文件残留只是浪费一点磁盘，
     * 不该让删除接口返回失败。
     */
    void delete(String url);
}