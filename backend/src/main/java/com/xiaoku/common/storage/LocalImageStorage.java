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
import java.util.Set;
import java.util.UUID;

/**
 * 本地磁盘图片存储（开发期默认实现）。
 *
 * <p>目录形如 {@code uploads/2026/09/27/<uuid>.webp}，按天分目录是为了避免
 * 单目录下文件过万导致 ext4 的性能塌掉。
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "xiaoku.storage.type", havingValue = "local", matchIfMissing = true)
public class LocalImageStorage implements ImageStorage {

    private static final DateTimeFormatter DATE_DIR = DateTimeFormatter.ofPattern("yyyy/MM/dd");

    /**
     * <b>为什么用 content type 反推扩展名，而不是用原始文件名？</b>
     * <p>原始文件名是<b>用户可控输入</b>，直接拿它拼路径有两个致命问题：
     * <ol>
     *   <li><b>路径穿越</b>：文件名传 {@code ../../../../etc/cron.d/evil}，
     *       拼接后写到任意位置；</li>
     *   <li><b>扩展名伪装</b>：传 {@code evil.jsp}，静态资源映射虽不会执行 JSP，
     *       但一旦后续加了模板渲染或反向代理规则就可能被当脚本解析。</li>
     * </ol>
     * 所以文件名一律由服务端生成（UUID），扩展名只从<b>白名单</b>里按 content type 取。
     */
    private static final Map<String, String> EXT_BY_CONTENT_TYPE = Map.of(
            "image/jpeg", ".jpg",
            "image/png", ".png",
            "image/webp", ".webp",
            "image/gif", ".gif"
    );

    private static final Set<String> ALLOWED_CONTENT_TYPES = EXT_BY_CONTENT_TYPE.keySet();

    /** 单图上限，与 application.yml 的 multipart.max-file-size 保持一致 */
    private static final long MAX_SIZE = 10L * 1024 * 1024;

    private final StorageConfig storageConfig;

    @Override
    public String store(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "图片不能为空");
        }
        if (file.getSize() > MAX_SIZE) {
            throw new BizException(ErrorCodeEnum.FILE_UPLOAD_TOO_LARGE, "单张图片不能超过 10MB");
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
        String filename = UUID.randomUUID().toString().replace("-", "") + ext;

        // 用 Path.resolve 拼路径而不是字符串 + 拼接，且全程不碰用户提供的文件名
        Path dir = Paths.get(storageConfig.getLocalPath(), dateDir).toAbsolutePath().normalize();
        Path target = dir.resolve(filename).normalize();
        if (!target.startsWith(dir)) {
            // 理论不可达（文件名是服务端生成的），但留着作为纵深防御
            throw new BizException(ErrorCodeEnum.NOTE_UPLOAD_FAILED, "图片保存路径非法");
        }

        try {
            Files.createDirectories(dir);
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.error("图片写入磁盘失败 dir={} file={}", dir, filename, e);
            throw new BizException(ErrorCodeEnum.NOTE_UPLOAD_FAILED);
        }

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
            // 删不掉只记日志：笔记本体已经删了，残留文件不该让整个请求失败
            log.warn("图片文件删除失败 url={}", url, e);
        }
    }
}
