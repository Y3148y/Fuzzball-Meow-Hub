package com.xiaoku.common.config;

import com.xiaoku.common.interceptor.AuthInterceptor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;
import java.nio.file.Paths;
import java.util.List;

/**
 * 拦截器与静态资源配置。
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class MvcConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;

    @Value("${xiaoku.storage.local-path:uploads}")
    private String localPath;

    @Value("${xiaoku.storage.local-url-prefix:/static/uploads}")
    private String localUrlPrefix;

    /**
     * 免鉴权路径。
     *
     * <p><b>白名单原则：默认全部需要登录，只显式列出例外。</b>
     * 反过来做（默认放行、逐个加保护）极易在新接口上线时忘记加保护，
     * 这类越权漏洞在测试环境往往发现不了。
     */
    private static final List<String> WHITE_LIST = List.of(
            // 健康检查
            "/api/system/ping",
            // 登录注册
            "/api/user/register",
            "/api/user/login",
            "/api/user/refresh",
            // 接口文档
            "/doc.html",
            "/favicon.ico",
            "/webjars/**",
            "/swagger-ui/**",
            "/swagger-ui.html",
            "/v3/api-docs",
            "/v3/api-docs/**",
            // 本地图片静态资源
            "/static/**",
            // 框架错误页，否则异常时会产生二次 404
            "/error"
    );

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns(WHITE_LIST)
                .order(0);
        log.info("已注册鉴权拦截器，白名单路径：{}", WHITE_LIST);
    }

    /**
     * 把本地磁盘上的图片目录映射成静态资源。
     *
     * <p>开发期图片直接落本地、静态映射出去，省掉一个对象存储；
     * 切到 S3 时这段配置自然失效，业务代码无感知。
     *
     * <p><b>安全提醒：</b>生产环境不应这样暴露，因为 {@code addResourceHandlers}
     * 会把目录下所有文件都开放。真实项目请走 Nginx / OSS 的签名 URL。
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        File uploadDir = Paths.get(localPath).toAbsolutePath().toFile();
        if (!uploadDir.exists() && uploadDir.mkdirs()) {
            log.info("创建本地图片存储目录：{}", uploadDir.getAbsolutePath());
        }
        String location = uploadDir.toURI().toString();
        log.info("本地图片静态映射：{}** -> {}", localUrlPrefix, location);
        registry.addResourceHandler(localUrlPrefix + "/**")
                .addResourceLocations(location);
    }
}
