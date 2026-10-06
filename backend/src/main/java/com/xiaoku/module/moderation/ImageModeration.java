package com.xiaoku.module.moderation;

/**
 * 图片内容审核
 *
 * <p>本轮**刻意不实现**真实检测：本机没有可用的图片识别服务，第三方内容安全 API
 * 又需要凭证与费用。写一个 {@code return null} 的实现却宣称「已接风控」是最坏
 * 的结果 —— 后面没人知道它其实什么都没做。
 *
 * <p>所以这里留的是**接口 + 显式关闭的开关**：开关默认 false，实现类里唯一做的事
 * 就是记一行日志说明「没开启」，把钩子位置留在上传路径上。等真接了服务，
 * 只需加一个实现类 + 改配置，不用再改发布/上传流程。
 */
public interface ImageModeration {

    /**
     * 校验一张已上传的图片
     *
     * @param imageUrl 图片地址（站内相对路径或外链）
     * @return 命中违规时给出拒绝理由；{@code null} 表示放行
     */
    Rejection check(String imageUrl);

    /** 审核拒绝结果 */
    record Rejection(String reason) {
    }
}