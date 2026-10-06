package com.xiaoku.module.moderation;

/**
 * 文本内容审核
 *
 * <p><b>为什么是接口而不是直接写个工具类</b>：审核规则一定会变（换词库、加规则、
 * 接第三方内容安全 API），而发布/评论是**所有**写内容的入口，规则一旦硬编码进去
 * 就散落在各处、没法统一开关。做成接口后，「换实现」与「关掉」都不动调用方。
 *
 * <p>实现约定：
 * <ul>
 *   <li>命中就抛 {@code BizException(CONTENT_SENSITIVE)}，**不要返回布尔让调用方自己判**
 *       —— 漏一处判就等于没审。</li>
 *   <li>实现内部出错（词库读不到等）应当**放行并记日志**，不能因为审核服务挂了
 *       就让全站发不了笔记。</li>
 * </ul>
 */
public interface TextModeration {

    /**
     * 校验一段文本，命中敏感词就抛异常
     *
     * @param text 待校验文本（标题/正文/评论内容）
     * @param scene 场景，用于日志与将来按场景差异化策略（如私信宽松、评论严格）
     */
    void check(String text, Scene scene);

    /** 审核场景 */
    enum Scene {
        /** 笔记标题 */
        NOTE_TITLE,
        /** 笔记正文 */
        NOTE_CONTENT,
        /** 评论 */
        COMMENT,
        /** 昵称 / 个人简介等资料 */
        PROFILE
    }
}