package com.xiaoku;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/**
 * 小哭猫 Xiaoku —— 应用入口
 *
 * <p>本项目为个人学习作品，用于准备后端开发岗位面试，与任何商业平台无任何关联。
 */
@SpringBootApplication
@EnableTransactionManagement
@EnableScheduling
@MapperScan("com.xiaoku.**.mapper")
public class XiaokuApplication {

    public static void main(String[] args) {
        SpringApplication.run(XiaokuApplication.class, args);
        System.out.println("""

                小哭猫 Xiaoku 启动成功
                  接口文档  http://localhost:8088/doc.html
                  OpenAPI   http://localhost:8088/v3/api-docs
                """);
    }
}
