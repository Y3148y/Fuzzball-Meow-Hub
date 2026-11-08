package com.xiaoku.common.storage;

import com.xiaoku.common.config.StorageConfig;
import com.xiaoku.common.support.VideoTranscoder;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * 本地视频存储（默认实现）
 *
 * <p>P19 只存原文件、P33 加转码 + 抽封面、<b>P48 升级为多码率</b>：
 * 一次上传最多产出 {@code 主档 720p + 次档 480p + 封面} 三个文件，
 * 全部整包返回（{@link Stored}），不再让调用方事后补查封面。
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
    /** P33：转码 + 抽封面。转码失败会降级为「保留原文件」，不让上传失败 */
    private final VideoTranscoder transcoder;

    @Override
    public Stored store(MultipartFile file) {
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
        // 原文件名（降级路径下它就是最终产物）；转码产物用**独立 UUID**命名 ——
        // 三个名字各不相同而不是「同一 base 换后缀」，这样清理逻辑（成功后删原文件）
        // 不用猜文件名，也不会出现 ffmpeg 读写同一个文件截断自己的事故。
        String origName = UUID.randomUUID().toString().replace("-", "") + ext;
        String primaryBase = UUID.randomUUID().toString().replace("-", "");
        String secondaryBase = UUID.randomUUID().toString().replace("-", "");
        Path dir = Paths.get(storageConfig.getLocalPath(), dateDir).toAbsolutePath().normalize();
        Path target = dir.resolve(origName).normalize();
        if (!target.startsWith(dir)) {
            throw new BizException(ErrorCodeEnum.NOTE_UPLOAD_FAILED, "视频存储路径非法");
        }

        try {
            Files.createDirectories(dir);
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.error("视频落盘失败 dir={} file={}", dir, origName, e);
            throw new BizException(ErrorCodeEnum.NOTE_UPLOAD_FAILED);
        }

        long mb = file.getSize() / 1024 / 1024;

        // P33：转码 + 抽封面；P48：多码率。
        //
        // ⚠️ **转码失败一律降级为「保留原文件」，不让整个上传失败**：
        // 用户传的就是 mp4/webm，原文件多半本来就能播，转码是
        // 「让它在更多设备上能播」的增强，不该成为「能不能发」的门禁。
        //
        // ⚠️ 降级时把原文件留着（不删）：它就是最终产物。
        // 转码成功时删原文件 —— 留着它只是浪费磁盘，而用户永远看不到它
        //（URL 已经指向转码产物）。
        VideoTranscoder.Result tr = transcoder.transcode(target, dir, primaryBase, secondaryBase);
        String urlPrefix = storageConfig.getLocalUrlPrefix() + "/" + dateDir + "/";
        if (tr.transcoded()) {
            deleteQuietly(target);
            long outMb = tr.video().toFile().length() / 1024 / 1024;
            log.info("视频已转码 {} → {} 档（{}MB → {}MB）{}s 封面={}",
                    origName, tr.variants().size(), mb, outMb, tr.durationSec(), tr.cover() != null);
            List<Quality> qualities = new ArrayList<>(tr.variants().size());
            for (VideoTranscoder.Variant v : tr.variants()) {
                qualities.add(new Quality(v.label(),
                        urlPrefix + v.video().getFileName(), v.width(), v.height()));
            }
            return new Stored(urlPrefix + tr.video().getFileName(),
                    tr.cover() == null ? null : urlPrefix + tr.cover().getFileName(),
                    qualities);
        }
        log.info("视频已存储 {}（{}MB，未转码：{}）", origName, mb, tr.reason());
        return new Stored(urlPrefix + origName, null, List.of());
    }

    /**
     * 取某个视频对应的封面 URL（转码时抽的那一帧）
     *
     * <p>{@link #store} 已经整包返回封面，这里是给<b>存量笔记</b>的补查路径：
     * 发布/编辑需要从 {@code videoUrl} 反推 {@code note.cover}，而库里
     * P48 之前的笔记没有这个问题（cover 已固化）。带磁盘存在性检查 ——
     * 降级的视频没有封面，裸推导会推出一个 404 的假封面对。
     *
     * <p>找不到就返回 {@code null}（封面是可选产物，没有它视频照样能用）。
     */
    @Override
    public String coverOf(String videoUrl) {
        String coverUrl = VideoTranscoder.coverUrlOf(videoUrl);
        if (coverUrl == null || !coverUrl.startsWith(storageConfig.getLocalUrlPrefix() + "/")) {
            return null;
        }
        try {
            String relative = coverUrl.substring(storageConfig.getLocalUrlPrefix().length() + 1);
            Path root = Paths.get(storageConfig.getLocalPath()).toAbsolutePath().normalize();
            Path cover = root.resolve(relative).normalize();
            return cover.startsWith(root) && Files.isRegularFile(cover) ? coverUrl : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static void deleteQuietly(Path p) {
        try {
            Files.deleteIfExists(p);
        } catch (IOException ignored) {
            // 残留只是浪费一点磁盘，不该让上传失败
        }
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