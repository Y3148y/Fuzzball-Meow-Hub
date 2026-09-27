package com.xiaoku;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/**
 * 毛球喵社 —— 应用入口
 *
 * <p>本项目为个人学习作品，用于准备后端开发岗位面试，与任何商业平台无任何关联。
 */
@SpringBootApplication
@EnableTransactionManagement
@EnableScheduling
// 必须显式开启：Spring Boot 只会自动配置 CacheManager（RedisCacheManager），
// 但「注册 CacheInterceptor 切面」这一步要靠 @EnableCaching。
// 漏掉它时不会报任何错，@Cacheable 只是静默失效 —— 缓存没生效却毫无提示，
// 是排查缓存问题时最容易被忽略的一个坑。
@EnableCaching
@MapperScan("com.xiaoku.**.mapper")
public class XiaokuApplication {

    public static void main(String[] args) {
        SpringApplication.run(XiaokuApplication.class, args);
        System.out.println("""

                毛球喵社 Fuzzball-Meow-Hub 启动成功
                  接口文档  http://localhost:8088/doc.html
                  OpenAPI   http://localhost:8088/v3/api-docs
                """);
    }
}
