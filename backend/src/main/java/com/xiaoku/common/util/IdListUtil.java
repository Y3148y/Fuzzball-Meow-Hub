package com.xiaoku.common.util;

import java.util.Collections;
import java.util.List;

/**
 * 把「前端传来的字符串 ID 列表」转成 {@code Long} 列表（P30）
 *
 * <p><b>为什么 DTO 里是 {@code List<String>} 而不是 {@code List<Long>}</b>：
 * AGENTS 第 6 节的雪花 ID 精度问题 —— 前端 ID 是 10^17 量级，超过
 * {@code Number.MAX_SAFE_INTEGER}（约 9.007×10^15），JSON.parse 阶段就静默
 * 四舍五入，<b>后端无论声明 Long 还是 String 都救不回</b>：收到的就是个错的数。
 * 所以约定前端一律按字符串传，DTO 用 {@code String} 承接。
 *
 * <p><b>为什么在这里转而不是在 controller</b>：两个入口（笔记、评论）都要转，
 * 而它们各自还有一堆别的校验。抽出来是为了让「非法 ID 该怎么处理」只有
 * 一份实现 —— 这类东西复制两份必然出现「一边静默丢弃一边抛异常」。
 *
 * <p><b>非法值一律丢弃，不抛异常</b>：用户可能打好字才遇到对方注销，
 * 为了一个已经注销的人发不出评论是很糟的体验，而且用户完全看不出原因。
 */
public final class IdListUtil {

    private IdListUtil() {
    }

    /**
     * @param ids 字符串 ID 列表，可为 null
     * @return 去重后的 Long 列表；输入为空或全非法时返回空列表（不会是 null）
     */
    public static List<Long> parse(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return ids.stream()
                .filter(java.util.Objects::nonNull)
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(IdListUtil::toLongOrNull)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
    }

    private static Long toLongOrNull(String s) {
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
