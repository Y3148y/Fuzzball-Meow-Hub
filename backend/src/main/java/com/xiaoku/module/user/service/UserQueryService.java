package com.xiaoku.module.user.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.constant.CacheNames;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.module.user.converter.UserConverter;
import com.xiaoku.module.user.entity.UserEntity;
import com.xiaoku.module.follow.entity.UserFollowEntity;
import com.xiaoku.module.user.mapper.UserBlockMapper;
import com.xiaoku.module.user.mapper.UserMapper;
import com.xiaoku.module.user.vo.UserPickVO;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.stream.Stream;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * 用户<b>读</b>侧组件，专门承载缓存逻辑。
 *
 * <p><b>为什么要单独抽一个 Bean，而不是直接把 {@code @Cacheable} 写在 UserServiceImpl 上：</b>
 * <p>Spring AOP 的缓存是「环绕通知」，只有<b>经过代理</b>的调用才会生效。
 * 一旦类内部写 {@code this.getUserVO(id)}，调用根本没出这个对象，代理无从介入，
 * {@code @Cacheable} 会被<b>静默跳过</b>——不报错、不告警，只是缓存一直没生效，
 * 只能靠看日志里 SQL 次数才发现。
 * <p>把带注解的方法挪到独立 Bean，调用方 {@code @Autowired} 注入后调用的是代理对象，
 * 注解才会生效。这也是「同一个类里既有读缓存又有写库逻辑」时的标准拆法。
 * <p>（另一种写法是注入自己：{@code @Autowired @Lazy UserService self;}，
 * 能跑但会产生 bean 自引用，事务/缓存的初始化顺序也更容易出问题，不推荐。）
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserQueryService {

    private final UserMapper userMapper;
    private final UserBlockMapper userBlockMapper;
    private final com.xiaoku.module.follow.mapper.UserFollowMapper userFollowMapper;

    /**
     * 按 id 读用户信息，走 Redis 缓存。
     *
     * <p>{@code sync = true}：同一个 key 上多个线程并发未命中时，
     * 只放一个线程去查库、其余线程等待结果（单机语义），避免热点 key 反复打到 DB。
     * <p>注意 {@code sync = true} 与 {@code unless} 互斥，且空结果不会被缓存
     * （CacheConfig 已全局 disableCachingNullValues）。
     */
    @Cacheable(cacheNames = CacheNames.USER_INFO, key = "#userId", sync = true)
    public UserVO getUserVO(Long userId) {
        UserEntity user = userMapper.selectById(userId);
        if (user == null) {
            throw new BizException(ErrorCodeEnum.USER_NOT_FOUND);
        }
        return UserConverter.toVO(user);
    }

    /**
     * 同 {@link #getUserVO}，但<b>用户不存在时返回 null 而不是抛异常</b>。
     *
     * <p>给「关联对象可能已被删除」的场景用，比如笔记详情要展示作者：
     * 作者注销不该让整篇笔记 500。
     *
     * <p><b>刻意不写成 {@code getUserVO 内部调 findUserVO}：</b>
     * 那是类内自调用，走不到代理，{@code @Cacheable} 会被静默跳过
     * （原因见本类注释）。两个方法各自带注解、各自查库，
     * 共享同一个 cacheName + key，不会互相污染。
     */
    @Cacheable(cacheNames = CacheNames.USER_INFO, key = "#userId", sync = true)
    public UserVO findUserVO(Long userId) {
        UserEntity user = userMapper.selectById(userId);
        return user == null ? null : UserConverter.toVO(user);
    }

    /**
     * 按用户名批量查 id（解析正文里的 @提及时用）
     *
     * <p><b>刻意不缓存</b>：username → id 是不可变的（用户名不可改），理论上
     * 可以缓存；但它只在「有人发 @某人」时才用到，量极小，而缓存就意味着多一套
     * key 设计与失效规则。这点收益不值得那套复杂度。
     *
     * <p>查不到的（不存在的用户名）不出现在结果里 —— 调用方据此安静地忽略，
     * 不报错：正文里写了个不存在的人名，不该让整篇笔记发不出来。
     *
     * @return username → userId
     */
    public Map<String, Long> findIdsByUsernames(List<String> usernames) {
        if (usernames == null || usernames.isEmpty()) {
            return Map.of();
        }
        List<String> distinct = usernames.stream().filter(Objects::nonNull).distinct().toList();
        if (distinct.isEmpty()) {
            return Map.of();
        }
        return userMapper.selectList(Wrappers.<UserEntity>lambdaQuery()
                        .select(UserEntity::getId, UserEntity::getUsername)
                        .in(UserEntity::getUsername, distinct))
                .stream()
                .collect(Collectors.toMap(UserEntity::getUsername, UserEntity::getId, (a, b) -> a));
    }

    /**
     * 用户信息变更后清缓存。
     *
     * <p><b>先删缓存还是先改库？</b>
     * <p>必须「先改库、再删缓存」：反过来会出现「删了缓存 → 改库失败 → 缓存里是旧值」，
     * 之后一直读到脏数据且不会再过期。
     * <p>即便顺序正确，并发下仍有一瞬间不一致：T1 改库完成、还没删缓存，此时 T2 读到旧缓存。
     * 窗口极小，工程上通常接受；要彻底消除需引入「版本号 / 延迟双删 / binlog 订阅」，
     * 那是更后面的问题。
     */
    @CacheEvict(cacheNames = CacheNames.USER_INFO, key = "#userId")
    public void evictUserVO(Long userId) {
        log.debug("已清理用户缓存 userId={}", userId);
    }

    /**
     * 批量取用户信息，<b>刻意不加 {@code @Cacheable}</b>。
     *
     * <p>缓存注解是按<b>单个 key</b> 工作的。一页 20 条评论可能涉及 20 个不同的用户，
     * 要让它们各自命中缓存就只能一个一个调 {@link #findUserVO(Long)}，
     * 那又回到了 N+1（而且每次都带一次 Redis 往返，未必比一条 IN 查询划算）。
     * 批量场景的正确做法是一条 {@code IN} 查库，把 N 次往返压成 1 次。
     *
     * <p>返回 Map 而不是 List 是为了让调用方按 id O(1) 取；
     * 查不到的用户<b>不在 Map 里</b>，调用方需用 {@code get()} 并处理 null
     * （对应「作者已注销」）。
     *
     * @param userIds 用户ID集合，会自动去重并忽略 null
     */
    public Map<Long, UserVO> findUserVOMap(Collection<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        List<Long> distinct = userIds.stream().filter(Objects::nonNull).distinct().toList();
        if (distinct.isEmpty()) {
            return Map.of();
        }
        return userMapper.selectBatchIds(distinct).stream()
                .collect(Collectors.toMap(UserEntity::getId, UserConverter::toVO));
    }

    /**
     * 按关键词搜「@ 提及」候选用户：<b>昵称与用户名都匹配</b>。
     *
     * <p><b>为什么两个字段都搜</b>：界面上到处显示的是昵称（「关注搭子」），
     * 而 {@code @} 之后真正插入的是用户名（{@code xk_ui_follow}）。
     * 只搜昵称 → 用户搜「关注搭子」搜得到但插进去是英文，用户困惑；
     * 只搜用户名 → 用户根本不知道那串英文是什么（P29 立项时用户反馈的
     * 原话是「我只能看到昵称，只能在主页看到用户名」）。
     * <b>两个都搜，两个都能命中，选中后一律插入用户名</b>（用户名唯一，
     * 昵称不唯一）。
     *
     * <p><b>排除拉黑</b>：{@code user_block} 双向生效（P18），拉黑的人不该
     * 出现在对方的候选列表里 —— 那等于「我藏了你，但你还能搜到我」。
     *
     * <p><b>排除自己</b>：服务端 {@code resolveMentionUserIds} 本来就会丢掉
     * 自己（自己提醒自己没意义），候选里还列出来只会让人点了没反应。
     *
     * <p><b>排除已注销/禁用账号</b>：否则会出现「搜得到但发出去解析不出」
     * 的鬼影 —— 发布不报错、@ 也渲染不出来，只有界面看不出异常。
     *
     * <p><b>刻意不加缓存</b>：搜索结果随昵称修改即时变化，缓存会让「刚改的
     * 昵称搜不到」，而这正是这个功能最容易踩的坑。
     */
    public List<UserPickVO> searchForMention(String keyword, Long viewerId, int limit) {
        String kw = keyword == null ? "" : keyword.trim();
        int cap = Math.max(1, Math.min(limit, 20));
        // ⚠️ 空关键词**不能**返回空列表（P30 修的真缺陷）：
        // 用户刚敲出 `@` 就停住是最常见的动作，此时就该看到候选 ——
        // 小红书正是这样。返回空列表的症状是「敲了 @ 什么都没什么都没」，
        // 而当时的 CDP 用例敲的是 `@xk_ui_inte`（带前缀），永远走不到这里。
        if (kw.isEmpty()) {
            return listMentionSuggestions(viewerId, cap);
        }
        List<Long> hidden = viewerId == null
                ? List.of()
                : userBlockMapper.selectHiddenUserIds(viewerId);
        List<UserEntity> rows = userMapper.selectList(Wrappers.<UserEntity>lambdaQuery()
                .select(UserEntity::getId, UserEntity::getUsername,
                        UserEntity::getNickname, UserEntity::getAvatar)
                .and(w -> w.like(UserEntity::getNickname, kw).or().like(UserEntity::getUsername, kw))
                .eq(UserEntity::getDeleted, 0)
                .eq(UserEntity::getStatus, 1)
                .ne(UserEntity::getId, viewerId)
                .last("LIMIT " + cap));
        if (!hidden.isEmpty()) {
            rows = rows.stream().filter(u -> !hidden.contains(u.getId())).toList();
        }
        return rows.stream().map(u -> UserPickVO.builder()
                .id(u.getId())
                .username(u.getUsername())
                .nickname(u.getNickname())
                .avatar(u.getAvatar())
                .build()).toList();
    }

    /**
     * 「我关注的人 + 我的粉丝」，按粉丝数降序（P30：敲出 @ 时的默认候选）
     *
     * <p><b>为什么是这两个集合</b>：用户最可能 @ 的就是认识的人，而认识的人
     * 只可能出现在「我关注的」或「关注我的」里。全站热门是陌生人，@ 陌生人的
     * 动机远弱于 @ 熟人。
     *
     * <p><b>为什么按粉丝数排序</b>：一个新人粉丝数 0，列表尾部就是新认识的人；
     * 而信息流里常见的人粉丝多 —— 这与用户「我认识谁」的直觉一致。
     *
     * <p><b>去重</b>：互相关注的人在两个集合里各出现一次，不去重会出现
     * 连续两行同名同头像，看起来像 bug。
     *
     * <p><b>排除拉黑（双向）</b>：同 {@code searchForMention} 的理由 ——
     * 藏了的人不该从候选里冒出来。
     */
    private List<UserPickVO> listMentionSuggestions(Long viewerId, int limit) {
        if (viewerId == null) {
            return List.of();
        }
        List<Long> following = userFollowMapper.selectList(Wrappers.<UserFollowEntity>lambdaQuery()
                        .select(UserFollowEntity::getFollowId)
                        .eq(UserFollowEntity::getUserId, viewerId))
                .stream().map(UserFollowEntity::getFollowId).toList();
        List<Long> fans = userFollowMapper.selectList(Wrappers.<UserFollowEntity>lambdaQuery()
                        .select(UserFollowEntity::getUserId)
                        .eq(UserFollowEntity::getFollowId, viewerId))
                .stream().map(UserFollowEntity::getUserId).toList();

        List<Long> ids = new ArrayList<>(new LinkedHashSet<>(
                Stream.concat(following.stream(), fans.stream())
                        .filter(Objects::nonNull)
                        .filter(id -> !id.equals(viewerId))
                        .toList()));
        if (ids.isEmpty()) {
            return List.of();
        }
        List<Long> hidden = userBlockMapper.selectHiddenUserIds(viewerId);
        ids = ids.stream().filter(id -> !hidden.contains(id)).toList();

        return userMapper.selectList(Wrappers.<UserEntity>lambdaQuery()
                        .select(UserEntity::getId, UserEntity::getUsername,
                                UserEntity::getNickname, UserEntity::getAvatar)
                        .in(UserEntity::getId, ids)
                        .eq(UserEntity::getDeleted, 0)
                        .eq(UserEntity::getStatus, 1)
                        .orderByDesc(UserEntity::getFansCount)
                        .orderByAsc(UserEntity::getId)
                        .last("LIMIT " + limit))
                .stream()
                .map(u -> UserPickVO.builder()
                        .id(u.getId())
                        .username(u.getUsername())
                        .nickname(u.getNickname())
                        .avatar(u.getAvatar())
                        .build())
                .toList();
    }
}
