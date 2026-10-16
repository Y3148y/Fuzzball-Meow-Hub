package com.xiaoku.common.support;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 视频转码（P33）
 *
 * <p><b>为什么现在才做</b>：P19 做完「上传 + 存原文件 + 播放器」时刻意不转码，
 * 理由是当时全库 {@code video_url} 全是 NULL —— 给一个 0 条数据的功能做转码是投机。
 * 现在做是因为 {@link com.xiaoku.common.storage.VideoStorage} 与前端播放器已经就位，
 * 剩下缺的只是这一段，而且缺它的代价是「手机拍的 HEVC / 高码率 4K 视频在浏览器里
 * 播不出来」。
 *
 * <p><b>同步而不是异步</b>：本机实测 60 秒 1080x1920 转 720x1280 只要 3.4s
 * （17.8x 实时，24 核），封面抽取 0.13s。同步完全在上传请求的预算内，
 * 而异步要引入「转码队列 + 状态机 + 失败重试 + 前端轮询转码进度」——
 * 一整套状态机的复杂度换一个 3.4 秒的等待，不划算。
 *
 * <p><b>降级策略</b>：ffpeg 不存在 / 转码失败时**保留原文件并继续**，
 * 而不是让整个上传失败。理由：原文件多半本来就能播（用户传的就是 mp4/webm），
 * 转码是「让它在更多设备上能播」的增强，不该成为「能不能发」的门禁。
 */
@Slf4j
@Component
public class VideoTranscoder {

    /**
     * ffmpeg 可执行路径
     *
     * <p>默认走 {@code ffmpeg}（依赖 PATH），可用配置覆盖成绝对路径 ——
     * 装在 E 盘或容器里的静态二进制都不在 PATH 上。
     */
    @Value("${xiaoku.video.ffmpeg-path:ffmpeg}")
    private String ffmpegPath;

    @Value("${xiaoku.video.ffprobe-path:ffprobe}")
    private String ffprobePath;

    @Value("${xiaoku.video.enabled:true}")
    private boolean enabled;

    /** 单条转码的最长执行时间（秒）。超时杀进程，不让它拖住上传线程 */
    private static final long TIMEOUT_SEC = 120;
    /** ffprobe 单独给 15s：它只读元数据，不该和转码一个量级的超时 */
    private static final long PROBE_TIMEOUT_SEC = 15;

    /** 目标分辨率：竖屏 720x1280 / 横屏 1280x720（小红书与各短视频平台的主流档） */
    private static final int SHORT_EDGE = 720;

    /** 转码结果 */
    public record Result(boolean transcoded, Path video, Path cover, int width, int height,
                         long durationSec, String reason) {
        /** 没转码时（降级）的便捷结果 */
        public static Result skipped(Path video, String reason) {
            return new Result(false, video, null, 0, 0, 0, reason);
        }
    }

    /** ffmpeg 是否可用（启动时打一条日志，省得第一次上传才发现没装） */
    @PostConstruct
    public void logAvailability() {
        if (!enabled) {
            log.info("视频转码：已关闭（xiaoku.video.enabled=false），上传会保留原文件");
            return;
        }
        // ⚠️ **启动时就把可用性打出来**。否则第一次上传走降级分支时，
        // 日志只有「未转码：<reason>」，而 reason 可能只是「源文件不存在」
        // 这种与 ffmpeg 无关的字样 —— 于是你会怀疑转码逻辑，
        // 而真因（路径写错 / 没装）只在这条启动日志里。
        boolean ok;
        String ver = "";
        try {
            ExecResult r = exec(List.of(ffmpegPath, "-version"), 15);
            ok = r.exitCode() == 0;
            if (ok) {
                String first = r.stdout().isEmpty() ? r.stderr() : r.stdout();
                ver = first.split("\n")[0];
            }
        } catch (Exception e) {
            ok = false;
            ver = e.getMessage();
        }
        if (ok) {
            log.info("视频转码：ffmpeg 可用（{}）｜{}｜ffprobe={}", ffmpegPath, ver, ffprobePath);
        } else {
            log.warn("视频转码：ffmpeg 不可用（{}），上传会**保留原文件**而不是失败。原因：{}",
                    ffmpegPath, ver);
        }
    }

    /**
     * 转码 + 抽封面
     *
     * @param src   原始视频（已在磁盘上）
     * @param dstDir 输出目录（与原文件同级，按日期分目录）
     * @param baseName 输出文件基名（UUID，与 LocalVideoStorage 一致）
     */
    public Result transcode(Path src, Path dstDir, String baseName) {
        // ⚠️ **每个降级出口都要打日志**：只有「未转码：<reason>」一行时，
        // reason 可能是「源文件不存在」这种与 ffmpeg 无关的字样，
        // 于是人会去怀疑转码逻辑，而真因（ffmpeg 没装 / 权限 / 路径）
        // 只在这一行里出现不了。降级路径必须自带可诊断性。
        log.info("转码开始 src={} base={} enabled={} ffmpeg={}", src, baseName, enabled, ffmpegPath);

        if (!enabled) {
            log.info("转码降级：enabled=false");
            return Result.skipped(src, "转码已关闭（xiaoku.video.enabled=false）");
        }
        if (!Files.isRegularFile(src)) {
            log.warn("转码降级：源文件不存在 src={} exists={}", src, Files.exists(src));
            return Result.skipped(src, "源文件不存在");
        }
        long srcSize = fileSize(src);
        if (srcSize == 0) {
            log.warn("转码降级：源文件是 0 字节 src={}", src);
            return Result.skipped(src, "源文件为空");
        }

        Probe probe;
        try {
            probe = probe(src);
        } catch (Exception e) {
            log.warn("转码降级：ffprobe 失败 src={} err={}", src, e.getMessage());
            return Result.skipped(src, "ffprobe 失败");
        }
        log.info("探针结果 {}x{} codec={} duration={}s", probe.width(), probe.height(),
                probe.codec(), probe.durationSec());
        if (probe.width() <= 0 || probe.height() <= 0) {
            log.warn("转码降级：取不到宽高 {}x{}", probe.width(), probe.height());
            return Result.skipped(src, "取不到宽高");
        }
        // 已经是目标规格的就别转了：白花 3.4s 换一个几乎一样的文件。
        // ⚠️ 判定**只看短边**，不看码率 —— 码率要 ffprobe 额外一程，
        // 而「短边已经是 720 且是 h264/aac」就已经足够说明没必要动它。
        //
        // ⚠️ 条件方向别写反：第一版写成 `min(target, shortEdge) <= 720`，
        // 于是 **1080x1920 的源（短边 1080）也算「已达标」而跳过转码** ——
        // min() 把「大」压成了「刚好达标」，符号反过来之后才正确。
        // 症状是「120MB 的视频传上去还是 120MB」，而日志说「未转码：已是目标规格」。
        boolean portrait = probe.height() >= probe.width();
        int shortEdge = Math.min(probe.width(), probe.height());
        if (shortEdge <= SHORT_EDGE && "h264".equalsIgnoreCase(probe.codec())) {
            log.info("转码降级：已是目标规格 {}x{} codec={} shortEdge={}", probe.width(), probe.height(),
                    probe.codec(), shortEdge);
            return Result.skipped(src, "已是目标规格（H.264 且短边≤720）");
        }
        log.info("需要转码：{}x{} codec={} shortEdge={} → {} 画布", probe.width(), probe.height(),
                probe.codec(), shortEdge, portrait ? "720x1280" : "1280x720");

        // ⚠️ **输出文件名必须与输入不同**。曾经直接用 `<base>.mp4`，
        // 而输入此刻也正是那个文件（store() 刚落盘）——ffmpeg 会把自己的
        // 输入截断，`exit=-22`（Invalid argument），产物 0 字节。
        // ⚠️ 这个 bug 极阴：手工跑同一条命令是**成功**的（因为输出目录不同），
        // 症状是「上传 200、下载 0、封面 404」，而日志里只有一行
        // `exit=-22` —— 真因（读写同一个文件）要对着参数列表逐个看才找得到。
        // 加 `-t <n>` 后缀而不是换目录：同目录换名字最省事，
        // 且清理逻辑（删原文件）不用跨目录判断。
        Path out = dstDir.resolve(baseName + "-t.mp4");
        Path cover = dstDir.resolve(baseName + ".jpg");
        try {
            Files.createDirectories(dstDir);
        } catch (IOException e) {
            log.warn("建输出目录失败，降级：{}", e.getMessage());
            return Result.skipped(src, "建输出目录失败");
        }

        // scale+pad：竖屏与横屏各自的画布尺寸不同，force_original_aspect_ratio=decrease
        // 保证不裁切（窄视频留黑边），pad 把它居中。
        // ⚠️ **不能用 -vf scale 只缩不补**：那样输出尺寸会随源变化，
        // 而播放器按固定比例摆容器，下一次换台设备播就是另一个比例。
        String canvas = portrait ? "720:1280" : "1280:720";
        List<String> cmd = new ArrayList<>(List.of(
                ffmpegPath,
                "-y",
                "-i", src.toString(),
                "-vf", "scale=" + canvas + ":force_original_aspect_ratio=decrease,pad=" + canvas + ":-1:-1",
                "-c:v", "libx264",
                // veryfast 而不是 slower：慢 1~2 倍画质几乎看不出差别，
                // 而转码时长直接决定用户上传时等多久。
                "-preset", "veryfast",
                "-crf", "23",
                // yuv420p 是浏览器兼容性的硬要求：H.264 的 4:2:2/4:4:4 profile
                // Chrome/Safari 都能播，但部分安卓机不能，而这个成本是零。
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "128k",
                // faststart 把 moov 原子挪到文件头：不加这条，播放器要下完整个文件
                // 才知道时长，于是「进度条卡在 0」一直等到缓冲完 —— 表现为「点播放没反应」。
                "-movflags", "+faststart",
                out.toString()));

        long start = System.currentTimeMillis();
        ExecResult r;
        try {
            r = exec(cmd, TIMEOUT_SEC);
        } catch (Exception e) {
            log.warn("调起 ffmpeg 失败，降级为不转码：{}", e.getMessage());
            deleteQuietly(out);
            return Result.skipped(src, "ffmpeg 调起失败");
        }
        long cost = System.currentTimeMillis() - start;
        if (r.exitCode() != 0 || !Files.isRegularFile(out) || fileSize(out) == 0) {
            // ⚠️ stderr 要**打全**：第一版只打末段 400 字符，而 ffmpeg 的
            // 参数错误写在**第一行**（「Unrecognized option ...」），末段反而是
            // 「Output file is empty」这种下游现象 —— 于是只能看到症状看不到原因。
            log.warn("转码失败（exit={}），降级为保留原文件。命令={} | stderr 头={} | stderr 尾={}",
                    r.exitCode(), String.join(" ", cmd), head(r.stderr(), 300), tail(r.stderr(), 300));
            deleteQuietly(out);
            return Result.skipped(src, "转码失败（exit=" + r.exitCode() + "）");
        }

        // 封面：取第 1 秒而不是第 0 帧 —— 手机拍的视频第 0 帧常常是纯黑
        // （还没对上焦），抽出来是张黑图。
        // ⚠️ 封面失败**不影响视频**：封面只是列表页与沉浸流的缩略图，
        // 没有它播放器照样能用，而为一个可选产物让整次上传失败不划算。
        boolean coverOk = false;
        try {
            ExecResult cr = exec(List.of(ffmpegPath, "-y", "-ss", "1", "-i", src.toString(),
                    "-frames:v", "1", "-q:v", "3", cover.toString()), TIMEOUT_SEC);
            coverOk = cr.exitCode() == 0 && Files.isRegularFile(cover) && fileSize(cover) > 0;
            if (!coverOk) {
                log.warn("抽封面失败（exit={}），视频仍可用", cr.exitCode());
                deleteQuietly(cover);
            }
        } catch (Exception e) {
            log.warn("抽封面调起失败，视频仍可用：{}", e.getMessage());
        }

        log.info("视频转码完成：{}x{} {}s→{}ms 输出 {}KB 封面={}",
                probe.width(), probe.height(), probe.durationSec(), cost,
                fileSize(out) / 1024, coverOk);
        return new Result(true, out, coverOk ? cover : null,
                portrait ? 720 : 1280, portrait ? 1280 : 720, probe.durationSec(), null);
    }

    /**
     * 由视频 URL 推出封面 URL
     *
     * <p>转码产物叫 {@code <base>-t.mp4}，封面叫 {@code <base>.jpg} ——
     * 所以这里要去掉 {@code -t} 而不是替换扩展名。
     * 命名分开的理由见上面「输出文件名必须与输入不同」那条注释。
     */
    public static String coverUrlOf(String videoUrl) {
        if (videoUrl == null) {
            return null;
        }
        return videoUrl.replaceFirst("(?i)-t\\.(mp4|webm)$", ".jpg");
    }

    /* ================= 内部 ================= */

    /** ffprobe 读到的元数据 */
    private record Probe(int width, int height, String codec, long durationSec) {
    }

    /**
     * 读元数据
     *
     * <p>刻意**只调一次 ffprobe** 且只取需要的四个字段：每次多一程进程启动
     * 都是几十到上百毫秒，而上传请求里这是纯开销。
     */
    private Probe probe(Path src) throws IOException, InterruptedException {
        List<String> cmd = List.of(ffprobePath,
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,codec_name:format=duration",
                "-of", "default=noprint_wrappers=1:nokey=0",
                src.toString());
        ExecResult r = exec(cmd, PROBE_TIMEOUT_SEC);
        if (r.exitCode() != 0) {
            throw new IOException("ffprobe exit=" + r.exitCode());
        }
        int w = 0, h = 0;
        String codec = "";
        long dur = 0;
        for (String line : r.stdout().split("\n")) {
            String s = line.trim();
            // ⚠️ **一律用 split("=", 2) 而不是 substring(n)**：
            // substring 砍字符数一旦算错就把值啃掉一截 —— 第一版
            // `s.substring(12)` 取 `codec_name=h264` 得到 `264`（h 被吃掉），
            // 于是「是不是 h264」的判定恒为 false，**每一次都去转码**，
            // 而症状是「日志说 codec=264，真 ffprobe 输出是 h264」——
            // 真因与现象隔了一层，且没有任何报错。
            if (s.startsWith("width=")) {
                w = parse(s.split("=", 2)[1]);
            } else if (s.startsWith("height=")) {
                h = parse(s.split("=", 2)[1]);
            } else if (s.startsWith("codec_name=")) {
                codec = s.split("=", 2)[1].trim();
            } else if (s.startsWith("duration=")) {
                dur = (long) Double.parseDouble(s.split("=", 2)[1].trim());
            }
        }
        return new Probe(w, h, codec, dur);
    }

    private static int parse(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private record ExecResult(int exitCode, String stdout, String stderr) {
    }

    /**
     * 跑一个外部命令，带超时，<b>stdout 与 stderr 都读</b>
     *
     * <p>⚠️ **两条流都必须读**，这是本实现最容易错的一处：
     * 第一版只起了个线程读 stderr，stdout 留着没人管 ——
     * 于是 {@code ffprobe} 的元数据（width/height/codec/duration）全丢了，
     * 探针解析出来是 {@code 0x0}，转码每次都走「取不到宽高」的降级分支。
     * <b>症状是「上传成功但文件没变小」，而日志只说「0x0」</b>，
     * 真因（读漏了一条流）隔了好几层。
     * 小输出时管道缓冲装得下，进程不会阻塞，所以<b>不会超时也不会报错</b> ——
     * 这就是它能一路绿灯到今天的原因。
     *
     * <p>另外 stderr 必须**单独**读：ffmpeg 的日志量大到写满管道时会阻塞，
     * 表现为「转码卡住」。
     */
    private ExecResult exec(List<String> cmd, long timeoutSec) throws IOException, InterruptedException {
        Process p = new ProcessBuilder(cmd).redirectErrorStream(false).start();

        StringBuilder out = new StringBuilder();
        StringBuilder err = new StringBuilder();
        Thread outReader = drain(p.getInputStream(), out);
        Thread errReader = drain(p.getErrorStream(), err);
        outReader.setDaemon(true);
        errReader.setDaemon(true);
        outReader.start();
        errReader.start();

        boolean done = p.waitFor(timeoutSec, TimeUnit.SECONDS);
        if (!done) {
            p.destroyForcibly();
            p.waitFor(5, TimeUnit.SECONDS);
            return new ExecResult(-1, out.toString(), err + "\n[超时 " + timeoutSec + "s 已强杀]");
        }
        outReader.join(1500);
        errReader.join(1500);
        return new ExecResult(p.exitValue(), out.toString(), err.toString());
    }

    /** 把一条流读完到 sb。进程被杀时这里是正常结束。 */
    private static Thread drain(InputStream is, StringBuilder sb) {
        return new Thread(() -> {
            try (InputStream in = is) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                }
            } catch (IOException ignored) {
                // 进程被 destroyForcibly 时这里抛的是正常现象
            }
        });
    }

    private static long fileSize(Path p) {
        try {
            return Files.size(p);
        } catch (IOException e) {
            return 0;
        }
    }

    private static String tail(String s, int n) {
        if (s == null) {
            return "";
        }
        return s.length() <= n ? s : s.substring(s.length() - n);
    }

    /** stderr 的**头**若干字符：ffmpeg 的参数错误写在这里 */
    private static String head(String s, int n) {
        if (s == null) {
            return "";
        }
        return s.length() <= n ? s : s.substring(0, n);
    }

    private static void deleteQuietly(Path p) {
        try {
            Files.deleteIfExists(p);
        } catch (IOException ignored) {
            // 残留只是浪费一点磁盘，不该让上传失败
        }
    }
}