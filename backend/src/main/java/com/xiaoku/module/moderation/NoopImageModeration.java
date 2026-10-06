package com.xiaoku.module.moderation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 图片审核的默认实现：**永远放行**，且把这件事明确说清楚。
 *
 * <p>它不是「占位符忘了填」，而是一个**有意的 no-op**：本项目没有可用的图片识别
 * 依赖（见 {@link ImageModeration} 的说明）。它的价值在于让日志里留下
 * 「图片审核未开启」，避免将来有人以为图片这条链路已经被审过了。
 *
 * <p>开关默认 false。真接了第三方内容安全 API 时，写一个新的 {@code @Component}
 * 实现同一个接口，把这个默认实现用 {@code @ConditionalOnMissingBean} 之类让位，
 * 或者直接改这里的实现体即可。
 */
@Component
public class NoopImageModeration implements ImageModeration {

    private static final Logger log = LoggerFactory.getLogger(NoopImageModeration.class);

    private final boolean enabled;

    public NoopImageModeration(@Value("${xiaoku.moderation.image.enabled:false}") boolean enabled) {
        this.enabled = enabled;
        if (!enabled) {
            log.warn("图片审核未开启（xiaoku.moderation.image.enabled=false），"
                    + "上传的图片不做任何违规检测 —— 这是当前实现的真实状态，不要误以为已接风控");
        } else {
            log.error("xiaoku.moderation.image.enabled=true 但仓库里没有真实图片审核实现，"
                    + "图片仍将全部放行；请补一个 ImageModeration 实现类");
        }
    }

    @Override
    public Rejection check(String imageUrl) {
        return null;
    }
}