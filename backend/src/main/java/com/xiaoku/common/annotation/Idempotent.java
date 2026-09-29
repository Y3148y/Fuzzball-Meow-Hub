package com.xiaoku.common.annotation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 接口幂等。
 *
 * <p>要解决的问题：移动端弱网下用户点「发布」，请求其实已经到服务端并成功落库了，
 * 只是响应包丢了。用户看到按钮转圈没反应，再点一次 —— 于是<b>同一篇笔记被发了两遍</b>。
 * 前端靠「按钮置灰」只能挡住*同一个页面内*的连点，挡不住
 * 「超时重试」「切后台再回来重试」「网关重试」这些路径。
 *
 * <p>协议：客户端在请求头 {@code X-Idempotency-Key} 里带一个**每次逻辑操作新生成**的
 * 随机串，重试时<b>沿用同一个串</b>。服务端行为：
 * <ol>
 *     <li>第一次见到这个 key：占位，然后正常执行，把成功结果缓存下来；</li>
 *     <li>再见到：直接把缓存的结果原样返回（客户端因此拿到同一个 noteId，
 *         而不是 100004 报错 —— 报错的话客户端重试了也拿不回自己刚创建的资源）；</li>
 *     <li>但如果上一次<b>还在执行中</b>（并发重试），返回 100004，让客户端稍后再试。</li>
 * </ol>
 *
 * <p><b>不带这个头就当没开幂等</b>（直接放行）。这样老版本客户端、
 * curl、Postman 都不会被这个特性误伤，也不用为它改任何已有代码。
 *
 * @see com.xiaoku.common.aspect.IdempotentAspect
 */
@Documented
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Idempotent {

    /**
     * 结果缓存秒数。
     *
     * <p>取值要大于「客户端最可能重试的时间窗」。默认 10 分钟是因为
     * 弱网重试一般发生在秒级到分钟级；再长只会白白占内存 ——
     * 笔记发布这种低频写操作，10 分钟内的重复请求本来就该被识别为同一次操作。
     */
    int seconds() default 600;
}
