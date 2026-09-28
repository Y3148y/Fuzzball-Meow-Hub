package com.xiaoku.common.storage;

import org.springframework.web.multipart.MultipartFile;

/**
 * 图片存储抽象。
 *
 * <p><b>为什么不直接写死本地磁盘：</b>开发期落本地盘便于调试，
 * 上线后多半要换成对象存储（阿里云 OSS / 腾讯云 COS / S3 兼容的 R2）。
 * 如果 Service 层直接依赖 {@code java.io.File}，切存储就得改业务代码。
 * 这里抽出接口，业务只认「给我一个文件，还我一个可访问 URL」，
 * 换实现时业务代码零改动 —— 面向接口的最朴素用法。
 *
 * <p>实现类通过 {@code xiaoku.storage.type} 决定（local / s3）。
 */
public interface ImageStorage {

    /**
     * 保存图片并返回对外可访问的 URL。
     *
     * @param file 上传的文件
     * @return 可访问 URL，例如 /static/uploads/2026/09/27/xxx.webp
     */
    String store(MultipartFile file);

    /**
     * 删除图片。
     *
     * <p>笔记是软删除（status=2）还是硬删除，取决于是否要回收磁盘文件。
     * 默认实现里本地存储直接删文件；对象存储实现可先移到回收站再彻底删。
     */
    void delete(String url);
}
