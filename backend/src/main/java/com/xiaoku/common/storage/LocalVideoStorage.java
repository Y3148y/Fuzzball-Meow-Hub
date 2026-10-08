package com.xiaoku.common.storage;

import com.xiaoku.common.config.StorageConfig;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * 本地视频存储（默认实现）
 *
 * <p><b>本轮只存原文件，不做转码。</b>这不是省事，而是明确的边界：
 * 转码要引入 ffmpeg 依赖、CPU 开销、以及「转码失败怎么办」的一整套状态机，
 * 属于要单独立项的工程。反过来，「能上传能播」这件事本身有价值 ——
 * 现在 {@code note.video_url} 存了但详情页根本不播，等于这个字段是死的。
 *
 * <p><b>只放行 mp4 / webm</b>：这两种浏览器能直接播，不需要转码。
 * 放行 mov/avi 的话，用户上传完在浏览器里看到的是黑屏加一个下载按钮，
 * 比明确拒绝更糟。mov 可以在前端提示用户先转格式。
 *
 * <p>安全模型与 {@link LocalImageStorage} 完全一致：
 * <ol>
 *   <li><b>绝不使用原始文件名</b>：{@code ../../etc/cron.d/evil} 能路径穿越，
 *       而服务端拼出的 {@code uploads/xxx.jsp} 会被 Tomcat 当 JSP 执行</li>
 *   <li><b>文件名一律 UUID</b>，<b>扩展名按 content type 反查</b>（只允许映射表内）</li>
 *   <li>拼完路径后 {@code startsWith(dir)} 再确认一次没跳出目录</li>
 * </ol>
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "xiaoku.storage.type", havingValue = "local", matchIfMissing = true)
public class LocalVideoStorage implements VideoStorage {

    private static final DateTimeFormatter DATE_DIR = DateTimeFormatter.ofPattern("yyyy/MM/dd");

    private static final Map<String, String> EXT_BY_CONTENT_TYPE = Map.of(
            "video/mp4", ".mp4",
            "video/webm", ".webm"
    );

    /** 单个视频上限 200MB：与 application.yml 的 multipart 上限一致 */
    private static final long MAX_SIZE = 200L * 1024 * 1024;

    private final StorageConfig storageConfig;

    @Override
    public String store(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "视频不能为空");
        }
        if (file.getSize() > MAX_SIZE) {
            throw new BizException(ErrorCodeEnum.FILE_UPLOAD_TOO_LARGE, "单个视频不能超过 200MB");
        }
        String contentType = file.getContentType() == null
                ? ""
                : file.getContentType().toLowerCase(Locale.ROOT);
        String ext = EXT_BY_CONTENT_TYPE.get(contentType);
        if (ext == null) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR,
                    "只支持 mp4 / webm 格式（浏览器要能直接播，mov/avi 需要转码）");
        }

        String dateDir = LocalDate.now().format(DATE_DIR);
        String filename = UUID.randomUUID().toString().replace("-", "") + ext;
        Path dir = Paths.get(storageConfig.getLocalPath(), dateDir).toAbsolutePath().normalize();
        Path target = dir.resolve(filename).normalize();
        if (!target.startsWith(dir)) {
            throw new BizException(ErrorCodeEnum.NOTE_UPLOAD_FAILED, "视频存储路径非法");
        }

        try {
            Files.createDirectories(dir);
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.error("视频落盘失败 dir={} file={}", dir, filename, e);
            throw new BizException(ErrorCodeEnum.NOTE_UPLOAD_FAILED);
        }

        long mb = file.getSize() / 1024 / 1024;
        log.info("视频已存储 {}（{}MB，无转码）", filename, mb);
        return storageConfig.getLocalUrlPrefix() + "/" + dateDir + "/" + filename;
    }

    @Override
    public void delete(String url) {
        String prefix = storageConfig.getLocalUrlPrefix() + "/";
        if (url == null || !url.startsWith(prefix)) {
            return;
        }
        try {
            String relative = url.substring(prefix.length());
            Path root = Paths.get(storageConfig.getLocalPath()).toAbsolutePath().normalize();
            Path target = root.resolve(relative).normalize();
            if (target.startsWith(root)) {
                Files.deleteIfExists(target);
            }
        } catch (IOException e) {
            log.warn("视频删除失败 url={}", url, e);
        }
    }
}