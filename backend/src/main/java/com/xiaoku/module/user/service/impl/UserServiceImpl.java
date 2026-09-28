package com.xiaoku.module.user.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.config.JwtProperties;
import com.xiaoku.common.context.LoginUser;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.util.JwtUtil;
import com.xiaoku.common.util.SnowflakeIdGenerator;
import com.xiaoku.module.user.dto.UserLoginDTO;
import com.xiaoku.module.user.dto.UserProfileUpdateDTO;
import com.xiaoku.module.user.dto.UserRegisterDTO;
import com.xiaoku.module.user.converter.UserConverter;
import com.xiaoku.module.user.entity.UserEntity;
import com.xiaoku.module.user.mapper.UserMapper;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.service.UserService;
import com.xiaoku.module.user.vo.LoginVO;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserServiceImpl implements UserService {

    private final UserMapper userMapper;
    private final UserQueryService userQueryService;
    private final JwtUtil jwtUtil;
    private final JwtProperties jwtProperties;
    private final SnowflakeIdGenerator snowflakeIdGenerator;
    private final BCryptPasswordEncoder passwordEncoder;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public UserVO register(UserRegisterDTO dto) {
        // 唯一索引才是并发安全的兜底。这里的「先查后插」只是为了给出更友好的错误提示，
        // 存在竞态（两个请求同时查到不存在 → 都去插入），
        // 真正的防线是后面 catch 到的 DuplicateKeyException。
        //
        // 注意 selectCount 返回的是 Long，<b>无匹配时是 0 而不是 null</b>，
        // 所以判断必须写成 `> 0`，只判 `!= null` 会导致所有注册都报「用户名已被占用」。
        Long existed = userMapper.selectCount(Wrappers.<UserEntity>lambdaQuery()
                .eq(UserEntity::getUsername, dto.getUsername()));
        BizException.throwIf(existed != null && existed > 0, ErrorCodeEnum.USERNAME_ALREADY_EXISTS);

        UserEntity user = new UserEntity();
        user.setId(snowflakeIdGenerator.nextId());
        user.setUsername(dto.getUsername());
        // BCrypt 自带随机盐，同一口令每次加密结果都不同，所以登录时不能用 SQL 比对口令
        user.setPassword(passwordEncoder.encode(dto.getPassword()));
        user.setNickname(StringUtils.hasText(dto.getNickname()) ? dto.getNickname() : dto.getUsername());
        user.setGender(0);
        user.setFollowCount(0);
        user.setFansCount(0);
        user.setLikeReceivedCount(0);
        user.setStatus(1);

        try {
            userMapper.insert(user);
        } catch (DuplicateKeyException e) {
            // 并发注册同名：唯一索引 uk_username 拦下来了，翻译成业务异常
            throw new BizException(ErrorCodeEnum.USERNAME_ALREADY_EXISTS);
        }
        log.info("用户注册成功 userId={} username={}", user.getId(), user.getUsername());
        return userQueryService.getUserVO(user.getId());
    }

    @Override
    public LoginVO login(UserLoginDTO dto) {
        UserEntity user = userMapper.selectOne(Wrappers.<UserEntity>lambdaQuery()
                .eq(UserEntity::getUsername, dto.getUsername()));

        // 用户不存在与口令错误返回<b>同一个</b>错误码。
        // 区分开就等于告诉攻击者「这个用户名是真实存在的」，可以据此枚举用户。
        if (user == null || !passwordEncoder.matches(dto.getPassword(), user.getPassword())) {
            log.warn("登录失败 username={}（用户不存在或口令错误）", dto.getUsername());
            throw new BizException(ErrorCodeEnum.USERNAME_OR_PASSWORD_ERROR);
        }
        BizException.throwIf(user.getStatus() != null && user.getStatus() == 0,
                ErrorCodeEnum.USER_DISABLED);

        String accessToken = jwtUtil.createAccessToken(user.getId(), user.getUsername());
        String refreshToken = jwtUtil.createRefreshToken(user.getId());

        // 记录登录时间。这是一次轻量的写，放最后：
        // 万一失败不应该让整个登录回滚，登录成功比记录时间重要。
        UserEntity update = new UserEntity();
        update.setId(user.getId());
        update.setLastLoginTime(LocalDateTime.now());
        userMapper.updateById(update);

        return LoginVO.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .expiresIn(Math.toIntExact(TimeUnit.MINUTES.toSeconds(jwtProperties.getAccessTokenTtlMinutes())))
                .userInfo(UserConverter.toVO(user))
                .build();
    }

    @Override
    public LoginVO refresh(String refreshToken) {
        if (!StringUtils.hasText(refreshToken)) {
            throw new BizException(ErrorCodeEnum.TOKEN_INVALID);
        }
        var claims = jwtUtil.parse(refreshToken);
        // 必须是 refresh token。用 access token 来刷新等于绕过有效期限制
        jwtUtil.requireType(claims, "refresh");

        Long userId = jwtUtil.getUserId(claims);
        UserEntity user = userMapper.selectById(userId);
        if (user == null) {
            throw new BizException(ErrorCodeEnum.USER_NOT_FOUND);
        }
        BizException.throwIf(user.getStatus() != null && user.getStatus() == 0,
                ErrorCodeEnum.USER_DISABLED);

        return LoginVO.builder()
                .accessToken(jwtUtil.createAccessToken(user.getId(), user.getUsername()))
                .refreshToken(jwtUtil.createRefreshToken(user.getId()))
                .expiresIn(Math.toIntExact(TimeUnit.MINUTES.toSeconds(jwtProperties.getAccessTokenTtlMinutes())))
                .userInfo(UserConverter.toVO(user))
                .build();
    }
    @Override
    public UserVO getCurrentUserVO() {
        LoginUser loginUser = UserContextHolder.requireLogin();
        return userQueryService.getUserVO(loginUser.getUserId());
    }

    @Override
    public UserVO getUserVO(Long userId) {
        return userQueryService.getUserVO(userId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public UserVO updateProfile(UserProfileUpdateDTO dto) {
        Long userId = UserContextHolder.requireUserId();

        UserEntity update = new UserEntity();
        update.setId(userId);
        // 只把「本次真正提交」的字段塞进去。application.yml 里 MyBatis-Plus 配了
        // update-strategy: not_null，值为 null 的字段不会出现在 UPDATE 语句里，
        // 因此这里直接透传 DTO 即可实现「部分更新」，
        // 不会出现「用户只改了昵称，结果简介被清空」的问题。
        update.setNickname(dto.getNickname());
        update.setBio(dto.getBio());
        update.setGender(dto.getGender());
        userMapper.updateById(update);

        // 顺序：先改库、再删缓存。反过来的话，一旦 updateById 失败，
        // 缓存已被清空却还留着旧值，脏数据会一直读到 TTL 结束
        userQueryService.evictUserVO(userId);

        // 走缓存读，此时缓存已清空，必然回源数据库，拿到的一定是最新值
        return userQueryService.getUserVO(userId);
    }
}
