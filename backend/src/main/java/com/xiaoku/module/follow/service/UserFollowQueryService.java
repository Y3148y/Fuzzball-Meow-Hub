package com.xiaoku.module.follow.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.follow.vo.FollowUserVO;

import java.util.Collection;
import java.util.Set;

/**
 * 关注关系的<b>读</b>侧：是否关注、关注 / 粉丝列表。
 *
 * <p>所有「依赖当前浏览者」的 followed 状态都在这一侧算好，
 * 不进入 {@code UserVO} 的缓存（理由见 {@link FollowUserVO} 注释）。
 */
public interface UserFollowQueryService {

    /**
     * 当前用户是否关注了目标。
     *
     * @param userId   发起查询的用户（可能是当前登录者）
     * @param targetId 被关注的用户
     */
    boolean isFollowing(Long userId, Long targetId);

    /**
     * 批量查「userId 关注了 targetIds 里的哪些」，一次 IN 避免 N+1。
     *
     * @return 已关注的 targetId 集合；入参为空则返回空集
     */
    Set<Long> batchFollowingIds(Long userId, Collection<Long> targetIds);

    /**
     * 某用户**关注了谁**（全部 id，不分页）。
     *
     * <p>P44 私密账号过滤要用：发现流/沉浸流的 SQL 里要判断
     * 「这篇笔记的作者是不是我关注的人」——
     * 关注流天然满足（它列的就是我关注的人），发现流不满足。
     *
     * <p>为什么不在 SQL 里写 {@code EXISTS (SELECT 1 FROM user_follow ...)}：
     * 那是**逐行**的相关子查询（AGENTS P14 实测 discover p95 ≈ 80ms，
     * 排序那一级已经是 DEPENDENT SUBQUERY）。改成把 id 列表传进 SQL，
     * MySQL 能把它转成临时表做 hash join。
     */
    Set<Long> listFollowedIds(Long userId);

    /**
     * 某用户关注了谁（TA 的 followings），分页。
     *
     * <p>viewerId 与 targetUserId 可能不同：小明点开小红的关注列表，
     * 每行要知道「我（小明）是否也关注了这个人」。
     */
    PageVO<FollowUserVO> listFollowings(Long targetUserId, Long viewerId, int page, int size);

    /**
     * 谁关注了某用户（TA 的 fans），分页。followed 语义同 {@link #listFollowings}。
     */
    PageVO<FollowUserVO> listFans(Long targetUserId, Long viewerId, int page, int size);

    /**
     * 单个用户的「用户信息 + 当前浏览者是否已关注」，作者主页卡片用。
     *
     * <p>列表接口一次给一整页，作者主页只要一个用户，塞一页不划算；
     * 这个接口直接从缓存拿 UserVO、叠加一次 isFollowing，正好一个往返。
     */
    FollowUserVO getFollowStatus(Long targetUserId, Long viewerId);
}