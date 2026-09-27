package com.xiaoku.common.init;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.util.SnowflakeIdGenerator;
import com.xiaoku.module.user.entity.UserEntity;
import com.xiaoku.module.user.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 开发期种子数据初始化。
 *
 * <p>用代码而不是 {@code data.sql} 造数据，好处是口令走的是真实的 BCrypt 编码逻辑，
 * 不会出现「SQL 里写死的散列和代码里的算法对不上」的诡异问题。
 *
 * <p>只注册一个 {@link org.springframework.boot.ApplicationRunner} 而不是
 * {@code @PostConstruct}：后者在所有 Bean 初始化完成前执行，
 * 此时事务代理、数据源可能还没完全就绪。
 */
@Slf4j
@Component
@RequiredArgsConstructor
@Profile({"dev", "test"})
public class DevDataInitializer implements ApplicationRunner {

    private final UserMapper userMapper;
    private final BCryptPasswordEncoder passwordEncoder;
    private final SnowflakeIdGenerator snowflakeIdGenerator;

    @Value("${xiaoku.init-demo-data:true}")
    private boolean enabled;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void run(org.springframework.boot.ApplicationArguments args) {
        if (!enabled) {
            return;
        }
        createIfAbsent("xiaoku_demo", "小哭猫", "记录生活里的小确幸", "Xk@123456");
        createIfAbsent("xiaoku_test", "测试号", "这是 P2 联调用的测试账号", "Xk@123456");
        log.info("""

                ---------------- 演示账号已就绪 ----------------
                  用户名 xiaoku_demo / 口令 Xk@123456
                  用户名 xiaoku_test / 口令 Xk@123456
                ------------------------------------------------
                """);
    }

    private void createIfAbsent(String username, String nickname, String bio, String rawPassword) {
        Long existed = userMapper.selectCount(Wrappers.<UserEntity>lambdaQuery()
                .eq(UserEntity::getUsername, username));
        if (existed != null && existed > 0) {
            return;
        }
        UserEntity user = new UserEntity();
        user.setId(snowflakeIdGenerator.nextId());
        user.setUsername(username);
        user.setPassword(passwordEncoder.encode(rawPassword));
        user.setNickname(nickname);
        user.setBio(bio);
        user.setGender(0);
        user.setFollowCount(0);
        user.setFansCount(0);
        user.setLikeReceivedCount(0);
        user.setStatus(1);
        userMapper.insert(user);
        log.info("创建演示用户 id={} username={}", user.getId(), username);
    }
}
