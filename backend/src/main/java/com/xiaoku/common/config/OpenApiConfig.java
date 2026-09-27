package com.xiaoku.common.config;

import com.xiaoku.common.util.SnowflakeIdGenerator;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springdoc.core.models.GroupedOpenApi;import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 接口文档配置（Knife4j UI）。
 *
 * <p>访问地址：
 * <ul>
 *     <li>{@code http://localhost:8088/doc.html} —— Knife4j 增强 UI</li>
 *     <li>{@code http://localhost:8088/swagger-ui.html} —— 原生 Swagger UI</li>
 * </ul>
 */
@Configuration
public class OpenApiConfig {

    private static final String SECURITY_SCHEME_NAME = "Authorization";

    @Bean
    public OpenAPI xiaokuOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("毛球喵社 API")
                        .version("0.1.0")
                        .description("""
                                毛球喵社 —— 个人学习项目，用于准备后端开发岗位面试。

                                本项目与任何商业平台无任何关联，所有名称、界面与数据均为原创。
                                """)
                        .contact(new Contact().name("xiaoku").url("https://github.com/your-name/red-book"))
                        .license(new License().name("MIT")))
                .components(new Components().addSecuritySchemes(SECURITY_SCHEME_NAME,
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("登录接口返回的 token，不需手动填 'Bearer ' 前缀")))
                .addSecurityItem(new SecurityRequirement().addList(SECURITY_SCHEME_NAME));
    }

    /**
     * 调试时可以把某些免鉴权接口排除在统一鉴权头之外，
     * 避免每次都要手填 token。
     */
    @Bean
    public GroupedOpenApi userApi() {
        return GroupedOpenApi.builder()
                .group("01-用户模块")
                .pathsToMatch("/api/user/**")
                .build();
    }

    @Bean
    public GroupedOpenApi noteApi() {
        return GroupedOpenApi.builder()
                .group("02-笔记模块")
                .pathsToMatch("/api/note/**")
                .build();
    }

    @Bean
    public GroupedOpenApi interactionApi() {
        return GroupedOpenApi.builder()
                .group("03-互动模块")
                .pathsToMatch("/api/like/**", "/api/collect/**", "/api/comment/**")
                .build();
    }

    @Bean
    public GroupedOpenApi systemApi() {
        return GroupedOpenApi.builder()
                .group("04-系统与内部")
                .pathsToMatch("/api/system/**", "/api/internal/**")
                .build();
    }
}
