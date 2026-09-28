package com.xiaoku.module.user.service;

import com.xiaoku.common.constant.CacheNames;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.module.user.converter.UserConverter;
import com.xiaoku.module.user.entity.UserEntity;
import com.xiaoku.module.user.mapper.UserMapper;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.Collection;
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
}
