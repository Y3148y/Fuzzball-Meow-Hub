package com.xiaoku.module.note.support;

import com.xiaoku.module.follow.service.UserFollowQueryService;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 私密账号的可见性闸门（P44 隐私设置）。
 *
 * <p><b>为什么抽成独立组件而不是各处自己判断</b>：
 * 「这篇笔记对 TA 不可见」这件事要在**好几个地方**判断 ——
 * 笔记详情、评论列表、发现流、搜索、作者主页。
 * 两处各写一份的话，可见性规则迟早会漂移
 * （一处加了「作者本人可见」另一处没加），
 * 而漂移的方向是<b>私密内容泄露</b>，那是这个功能最不能出的错。
 *
 * <p><b>规则</b>（P44，与用户拍板的一致）：
 * <ul>
 *   <li>作者的 {@code is_private = 1}（私密账号）时，TA 的笔记<b>只有关注了 TA 的用户</b>能看</li>
 *   <li>「关注」是<b>单向</b>就算：我关注了 TA 就能看 TA 的私密笔记，TA 没关注我也能</li>
 *   <li>作者本人永远能看自己的笔记</li>
 * </ul>
 *
 * <p>⚠️ <b>不可见时报 20001（笔记不存在）而不是 20002（状态不对）</b>：
 * 「这篇是私密内容，你看不到」这句话本身就泄露了信息 ——
 * 而「不存在」没法区分「从没存在过」和「存在但你看不到」。
 */
@Component
@RequiredArgsConstructor
public class PrivacyGate {

    private final UserQueryService userQueryService;
    private final UserFollowQueryService userFollowQueryService;

    /**
     * 这位作者的笔记对 viewer 是不是不可见。
     *
     * @param authorId 笔记作者
     * @param viewerId 当前浏览者
     * @return true = 不可见（调用方应当按「不存在」处理）
     */
    public boolean isHidden(Long authorId, Long viewerId) {
        if (authorId == null || viewerId == null) {
            return false;
        }
        // 作者本人永远可见自己的笔记
        if (authorId.equals(viewerId)) {
            return false;
        }
        // 公开账号：绝大多数作者走这一支就返回了
        UserVO author = userQueryService.findUserVO(authorId);
        if (author == null || !Integer.valueOf(1).equals(author.getIsPrivate())) {
            return false;
        }
        // 私密账号：只有关注了 TA 的人能看
        return !userFollowQueryService.isFollowing(viewerId, authorId);
    }
}
