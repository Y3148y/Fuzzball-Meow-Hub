package com.xiaoku.module.moderation;

import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 基于**词库**的文本审核默认实现
 *
 * <p>只做「敏感词表命中」这一件事，不做语义审核 —— 语义审核需要模型或第三方
 * 内容安全 API，本项目没有那类依赖，做一个假的只会给人「已接风控」的错觉。
 *
 * <p>三条设计取舍，都是刻意选的：
 *
 * <ol>
 *   <li><b>命中整词、且要求词长 ≥2</b>：词库逐条 `contains`。单字词（如「钱」）
 *       在中文里误伤率极高，会把正常笔记全拦下来；所以读取时就把长度 &lt;2 的行丢掉。
 *       代价是「法轮功」这类 3 字词能拦，「赌」这种单字拦不住 —— 拦得住的边界
 *       要靠词库质量补，不要靠把单字也放进来。</li>
 *   <li><b>先做 NFKC 归一 + 转小写</b>：不归一的话，「ｓｐａｍ」「ＳＰＡＭ」这类
 *       全角字符能绕过纯小写匹配。归一化在匹配之前做，绕不过去。</li>
 *   <li><b>词库读不出来就放行</b>：审核服务自己挂了不该让全站发不了笔记，
 *       所以这里是 fail-open + WARN。</li>
 * </ol>
 *
 * <p>另外对连续重复做了压缩（「的的的」等价于「的的」），防「的的的賭」这类填充绕过。
 */
@Component
public class DefaultTextModeration implements TextModeration {

    private static final Logger log = LoggerFactory.getLogger(DefaultTextModeration.class);
    /** 词库里长度小于这个值的行一律忽略（见类注释第 1 条） */
    private static final int MIN_WORD_LENGTH = 2;

    private final boolean enabled;

    @Value("${xiaoku.moderation.text.words-file:classpath:moderation/words.txt}")
    private String wordsFile;

    /** 归一化后的词库；为空表示没加载到，检查会全部放行 */
    private Set<String> words = Set.of();

    public DefaultTextModeration(@Value("${xiaoku.moderation.text.enabled:true}") boolean enabled) {
        this.enabled = enabled;
    }

    @PostConstruct
    void load() {
        if (!enabled) {
            log.info("文本审核已关闭（xiaoku.moderation.text.enabled=false），发布与评论不做敏感词校验");
            return;
        }
        Resource res = new org.springframework.core.io.DefaultResourceLoader().getResource(wordsFile);
        if (!res.exists()) {
            // fail-open：词库缺失不该阻断发帖，但必须留下明确日志，否则「审核开着」
            // 这个假设会在生产里悄悄失效
            log.warn("敏感词库不存在：{}（文本审核将全部放行，请检查 xiaoku.moderation.text.words-file）", wordsFile);
            return;
        }
        Set<String> loaded;
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(res.getInputStream(), StandardCharsets.UTF_8))) {
            loaded = reader.lines()
                    // 先丢注释：**必须去空白后再判 #**，否则满缩进的注释行会漏进来，
                    // 被当成词条去匹配正常文本（首次实现时就是这么把 4 条词库读成 14 条的）
                    .map(String::strip)
                    .filter(line -> !line.isEmpty() && !line.startsWith("#"))
                    .map(this::normalize)
                    .filter(w -> w.length() >= MIN_WORD_LENGTH)
                    .collect(Collectors.toUnmodifiableSet());
        } catch (IOException e) {
            log.warn("读取敏感词库失败：{}（文本审核将全部放行）", wordsFile, e);
            return;
        }
        this.words = loaded;
        log.info("敏感词库已加载：{}（来自 {}）", loaded.size(), wordsFile);
    }

    @Override
    public void check(String text, Scene scene) {
        if (!enabled || words.isEmpty() || text == null || text.isBlank()) {
            return;
        }
        String normalized = normalize(text);
        if (normalized.isEmpty()) {
            return;
        }
        for (String word : words) {
            if (normalized.contains(word)) {
                // 只在服务端日志里记命中的词与场景，**不进异常 message**
                log.warn("内容审核拦截：场景={} 命中词库条目「{}」", scene, word);
                throw new BizException(ErrorCodeEnum.CONTENT_SENSITIVE);
            }
        }
    }

    /** NFKC 归一 + 小写；连续重复字符压缩成一个 */
    private String normalize(String raw) {
        String s = java.text.Normalizer.normalize(raw, java.text.Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT)
                .strip();
        StringBuilder sb = new StringBuilder(s.length());
        char prev = 0;
        for (char c : s.toCharArray()) {
            if (c != prev) {
                sb.append(c);
            }
            prev = c;
        }
        return sb.toString();
    }

    /** 供契约/调试查看当前生效的词条数量 */
    public int wordCount() {
        return words.size();
    }

    /** 供契约测试直接确认「词库加载成功」而不是被 fail-open 静默放行 */
    public List<String> words() {
        return List.copyOf(words);
    }
}