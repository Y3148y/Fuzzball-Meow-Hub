package com.xiaoku.module.user.support;

import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 预设头像白名单。
 *
 * <p><b>为什么需要它</b>：{@code user.avatar} 是一个用户可写的 URL 字段。
 * 如果直接透传，任何人都能把头像设成
 * {@code javascript:...}（在某些渲染路径下会变成 XSS 载体）、
 * {@code data:text/html;base64,...}、或指向内网地址的 URL
 * （用户列表页会给几十个人渲染头像，等于让攻击者借你的站点做内网探测 / 追踪像素）。
 *
 * <p>所以规则很窄，只有两种合法取值：
 * <ol>
 *   <li><b>预设</b>：必须在 {@link #PRESETS} 里（由前端生成器产出的 8 张静态图）</li>
 *   <li><b>本站上传</b>：必须以本站的静态上传前缀开头
 *       （{@value #UPLOAD_PREFIX}，由 ImageStorage 上传后生成）</li>
 * </ol>
 * 其余一律拒绝，**不做「宽松放行」**。
 *
 * <p>⚠️ ⚠️ <b>不能只靠 {@code startsWith}</b>。
 * {@code /static/uploads/../../secret.png} 字面上以本站前缀开头，
 * {@code startsWith} 会放行 —— 而它一旦存进库，浏览器就会拿这个 URL 去请求，
 * 服务端可能把 {@code ..} 解析到 uploads 之外。
 * <p>这不是「理论上」的问题：本项目的验收脚本第一条就是拿它当攻击样本，
 * 第一版 {@code startsWith} 实测<b>真的放行了（code=0）</b>。
 * 所以下面除了前缀判断，还显式拒绝 {@code ..}、反斜杠与重复斜杠。
 *
 * <p>预设头像图片由 {@code frontend/scripts/gen-default-avatars.mjs} 生成到
 * {@code frontend/public/avatars/}，改动配色/图形要改那个脚本后重跑，
 * <b>不要手改 PNG</b>（手改出来的图不在本白名单里就永远选不到）。
 */
@Component
public class AvatarPresets {

    /** 本站上传文件的静态前缀（与 ImageStorage 产出的 URL 前缀一致） */
    public static final String UPLOAD_PREFIX = "/static/uploads/";

    /** 8 张预设头像，顺序即前端展示顺序 */
    public static final List<String> PRESETS = List.of(
            "/avatars/01.png",
            "/avatars/02.png",
            "/avatars/03.png",
            "/avatars/04.png",
            "/avatars/05.png",
            "/avatars/06.png",
            "/avatars/07.png",
            "/avatars/08.png"
    );

    /**
     * 校验并归一化头像取值。
     *
     * @param avatar 客户端传来的值；null 表示「本次不修改头像」
     * @return 合法时返回可直接入库的值；null 表示不修改
     * @throws BizException 取值不在白名单内
     */
    public String validate(String avatar) {
        if (avatar == null) {
            return null;
        }
        String v = avatar.trim();
        // 空串 = 用户主动清空头像，回退到 null 让前端走兜底，
        // 而不是把空串写进库（空串在 <img src=""> 上正是裂图的来源，见 AGENTS P35）
        if (v.isEmpty()) {
            return null;
        }
        if (PRESETS.contains(v)) {
            return v;
        }
        // 上传地址：先按前缀筛掉绝大多数，再逐条挡掉路径形态上的花招。
        // ⚠️ 三条都要单独判 —— 只判前缀的话 /static/uploads/../../x.png 会被放行
        //    （这是实测踩到的，不是假想）。
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
        BizException.throwIf(true, ErrorCodeEnum.AVATAR_INVALID);
        return null;
    }

    /** 注册时按 id 取一个稳定的默认头像，避免所有新用户长得一模一样 */
    public static String defaultFor(long userId) {
        int idx = (int) Math.floorMod(userId / 1000L, PRESETS.size());
        return PRESETS.get(idx);
    }
}