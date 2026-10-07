package com.xiaoku.module.user.service;

import com.xiaoku.module.user.vo.BlockedUserVO;
import com.xiaoku.common.result.PageVO;

import java.util.List;
import java.util.Set;

/**
 * 黑名单
 *
 * <p><b>拉黑只影响「我」的视野，不通知对方</b>。这是与举报最本质的区别：
 * 举报是公共治理动作（要让运营知道），拉黑是私人屏蔽（对方不需要知道，
 * 甚至不该知道 —— 「XX 拉黑了你」这种提示会制造无谓的对抗）。
 */
public interface UserBlockService {

    /** 拉黑。重复拉黑返回 80005；拉黑自己返回 80007 */
    void block(Long userId, Long targetId);

    /** 取消拉黑。没拉黑过返回 80006 */
    void unblock(Long userId, Long targetId);

    /** 我拉黑的人（分页） */
    PageVO<BlockedUserVO> pageBlocked(Long userId, int page, int size);

    /**
     * 需要对我隐藏的用户集合（双向）
     *
     * <p>首页两个流、搜索回填都要用它。**两个方向都要**：
     * 对方拉黑我之后我也不该看见 TA 的内容，否则拉黑就成了单向可见。
     *
     * @return 空集合表示没有拉黑关系（调用方可以省掉 SQL 里的 NOT IN）
     */
    Set<Long> hiddenUserIds(Long userId);

    /** 单查：我是否拉黑了 TA（用于列表里的「已拉黑」状态） */
    boolean isBlocked(Long userId, Long targetId);
}