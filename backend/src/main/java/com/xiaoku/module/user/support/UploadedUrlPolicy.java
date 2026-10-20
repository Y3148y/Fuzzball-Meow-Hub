package com.xiaoku.module.user.support;

import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import org.springframework.stereotype.Component;

/**
 * 「本站上传文件」地址的白名单策略。
 *
 * <p><b>为什么要有它</b>：{@code user.avatar} 与 {@code user.background} 都是
 * **用户可写的 URL 字段**。直接透传的话，任何人都能把它们设成
 * {@code javascript:...}、{@code data:text/html;base64,...}，
 * 或指向内网地址的 URL —— 主页一次渲染几十个头像/背景，
 * 等于让攻击者借你的站点做内网探测 / 追踪像素。
 *
 * <p>所以规则很窄：只放行**本站上传目录**下的地址
 * （{@value #UPLOAD_PREFIX}，由 ImageStorage 上传后生成）。
 * 其余一律拒绝，<b>不做「宽松放行」</b>。
 *
 * <p>⚠️ ⚠️ <b>不能只靠 {@code startsWith}</b>。
 * {@code /static/uploads/../../secret.png} 字面上以本站前缀开头，
 * {@code startsWith} 会放行 —— 而它一旦存进库，浏览器就会拿这个 URL 去请求，
 * 服务端可能把 {@code ..} 解析到 uploads 之外。
 * <p>这不是「理论上」的问题：本项目的验收脚本第一条就是拿它当攻击样本，
 * 第一版 {@code startsWith} 实测<b>真的放行了（code=0）</b>。
 * 所以下面除了前缀判断，还显式拒绝 {@code ..}、反斜杠与重复斜杠。
 *
 * <p><b>为什么从 AvatarPresets 里抽出来</b>（P39）：
 * 背景图走的是<b>完全相同</b>的一套规则（只是没有「预设」那一档）。
 * 复制一份的话，两边的可疑字符清单迟早会漂移 ——
 * 而漂移的方向是「一边放行了一边没放行」，那就是个安全洞。
 * 单一来源比「每个字段各写一份」重要。
 */
@Component
public class UploadedUrlPolicy {

    /** 本站上传文件的静态前缀（与 ImageStorage 产出的 URL 前缀一致） */
    public static final String UPLOAD_PREFIX = "/static/uploads/";

    /**
     * 校验一个「本站上传地址」。
     *
     * @param value      客户端传来的值
     * @param invalidCode 不合法时抛出的业务错误码（头像与背景图各用自己的码）
     * @return 合法时返回原值（已 trim）；**空串返回 null**（= 清空）
     * @throws BizException 不是本站上传地址
     */
    public String validate(String value, ErrorCodeEnum invalidCode) {
        if (value == null) {
            return null;
        }
        String v = value.trim();
        // ⚠️ 空串 = 用户主动清空，**不是非法值**。
        //    返回 null 让调用方用 LambdaUpdateWrapper 显式 set null ——
        //    因为 update-strategy: not_null 会把 null 剔除掉，
        //    所以「清空」必须靠「validate 返回 null + 显式 set null」两步。
        //
        //    ⚠️ 第一版把空串当成非法值抛了出去，于是「清除背景图」按钮
        //    永远返回 10009 —— 而它的错误文案是「请重新上传」，
        //    用户明明点的是「清除」，提示却让他去上传，方向完全反了。
        if (v.isEmpty()) {
            return null;
        }
        if (v.startsWith(UPLOAD_PREFIX)) {
            boolean suspicious = v.contains("..")
                    || v.contains("\\")
                    || v.contains("//")
                    // 结尾的 / 会让浏览器去请求目录而不是文件
                    || v.endsWith("/")
                    // query / fragment：让 ?a=b 之类的尾巴混进来，
                    // 校验的是「路径」而不是「任意带前缀的字符串」
                    || v.indexOf('?') >= 0
                    || v.indexOf('#') >= 0;
            if (!suspicious) {
                return v;
            }
        }
        BizException.throwIf(true, invalidCode);
        return null;
    }
}
