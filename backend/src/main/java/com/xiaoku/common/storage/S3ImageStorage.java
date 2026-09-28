package com.xiaoku.common.storage;

import com.xiaoku.common.config.StorageConfig;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * S3 协议对象存储实现（阿里云 OSS / 腾讯云 COS / R2 等均兼容）。
 *
 * <p>只在 {@code xiaoku.storage.type=s3} 时装配，开发期默认走本地磁盘。
 * 扩展名同样<b>由服务端按 content type 决定</b>，理由见 {@link LocalImageStorage}。
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "xiaoku.storage.type", havingValue = "s3")
public class S3ImageStorage implements ImageStorage {

    private static final DateTimeFormatter DATE_DIR = DateTimeFormatter.ofPattern("yyyy/MM/dd");

    private static final Map<String, String> EXT_BY_CONTENT_TYPE = Map.of(
            "image/jpeg", ".jpg",
            "image/png", ".png",
            "image/webp", ".webp",
            "image/gif", ".gif"
    );

    private final StorageConfig storageConfig;
    private final S3Client s3Client;

    @Override
    public String store(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "图片不能为空");
        }
        String contentType = file.getContentType() == null
                ? ""
                : file.getContentType().toLowerCase(Locale.ROOT);
        String ext = EXT_BY_CONTENT_TYPE.get(contentType);
        if (ext == null) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR,
                    "仅支持 jpg / png / webp / gif 格式");
        }

        String dateDir = LocalDate.now().format(DATE_DIR);
        String key = "note/" + dateDir + "/" + UUID.randomUUID().toString().replace("-", "") + ext;

        try {
            s3Client.putObject(PutObjectRequest.builder()
                            .bucket(storageConfig.getBucket())
                            .key(key)
                            .contentType(contentType)
                            .build(),
                    RequestBody.fromInputStream(file.getInputStream(), file.getSize()));
        } catch (IOException | RuntimeException e) {
            log.error("对象存储写入失败 key={}", key, e);
            throw new BizException(ErrorCodeEnum.NOTE_UPLOAD_FAILED);
        }

        // path-style 与 virtual-hosted 两种寻址方式拼接方式不同
        String endpoint = storageConfig.getEndpoint();
        boolean pathStyle = Boolean.TRUE.equals(storageConfig.getPathStyleAccess());
        String base = pathStyle ? endpoint + "/" + storageConfig.getBucket() : endpoint;
        return base + "/" + key;
    }

    @Override
    public void delete(String url) {
        if (url == null || s3Client == null) {
            return;
        }
        // 从完整 URL 反推 key：最后一个 / 之后的部分往前拼到固定的 note/ 前缀
        int idx = url.indexOf("/note/");
        if (idx < 0) {
            log.warn("无法识别的对象存储 URL，跳过删除 url={}", url);
            return;
        }
        String key = url.substring(idx + 1);
        try {
            s3Client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(storageConfig.getBucket())
                    .key(key)
                    .build());
        } catch (RuntimeException e) {
            log.warn("对象存储删除失败 key={}", key, e);
        }
    }
}
