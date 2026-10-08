package com.xiaoku.common.storage;

import org.springframework.web.multipart.MultipartFile;

/**
 * 视频存储
 *
 * <p>与 {@link ImageStorage} 并列而不是共用一个接口：两者的**约束完全不同** ——
 * 图片是 10MB 内、数量受限（9 张/篇），视频是几十上百 MB、每篇一个。
 * 共用一个接口就得在每个方法里问「这次是图还是视频」，那是把调用方的
 * 类型信息藏进实现里。
 */
public interface VideoStorage {

    /**
     * 存一个视频，返回可直接访问的 URL
     *
     * @throws com.xiaoku.common.exception.BizException 类型不支持 / 超大 / 落盘失败
     */
    String store(MultipartFile file);

    /**
     * 删一个视频（按 URL）
     *
     * <p>删失败只记日志：笔记已经删了，文件残留只是浪费一点磁盘，
     * 不该让删除接口返回失败。
     */
    void delete(String url);
}