package com.xiaoku.common.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;
import java.nio.file.Paths;

@Slf4j
@Configuration
public class MvcConfig implements WebMvcConfigurer {

    @Value("${xiaoku.storage.local-path:uploads}")
    private String localPath;

    @Value("${xiaoku.storage.local-url-prefix:/static/uploads}")
    private String localUrlPrefix;

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
