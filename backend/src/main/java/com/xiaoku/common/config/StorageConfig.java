package com.xiaoku.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

/**
 * 对象存储配置。
 *
 * <p><b>为什么面向 S3 协议而不是绑死 MinIO：</b>
 * MinIO 开源版已于 2025 年归档停止维护，官方不再提供镜像与二进制；
 * 而 S3 协议才是业界事实标准 —— 阿里云 OSS、腾讯云 COS、七牛 Kodo、
 * AWS S3、Cloudflare R2 全都兼容。开发期用本地磁盘实现兜底，
 * 部署时改两行 endpoint 就能切到任意云厂商。
 */
@Configuration
@ConfigurationProperties(prefix = "xiaoku.storage")
public class StorageConfig {

    /**
     * storage.type = local 时用本地磁盘；= s3 时走 S3 协议。
     */
    private String type = "local";

    /** 本地存储根目录，相对路径以应用工作目录为基准 */
    private String localPath = "uploads";

    /** 本地存储对外访问前缀，配合 MvcConfig 的静态资源映射 */
    private String localUrlPrefix = "/static/uploads";

    /** S3 服务地址，如 https://oss-cn-hangzhou.aliyuncs.com */
    private String endpoint;

    /** 区域，如 cn-hangzhou */
    private String region = "cn-hangzhou";

    private String accessKey;

    private String secretKey;

    /** 桶名 */
    private String bucket = "xiaoku";

    /**
     * MinIO 等自建服务需要 path-style；阿里云 OSS 用 virtual-hosted-style。
     */
    private Boolean pathStyleAccess = true;

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getLocalPath() {
        return localPath;
    }

    public void setLocalPath(String localPath) {
        this.localPath = localPath;
    }

    public String getLocalUrlPrefix() {
        return localUrlPrefix;
    }

    public void setLocalUrlPrefix(String localUrlPrefix) {
        this.localUrlPrefix = localUrlPrefix;
    }

    public String getEndpoint() {
        return endpoint;
    }

    public void setEndpoint(String endpoint) {
        this.endpoint = endpoint;
    }

    public String getRegion() {
        return region;
    }

    public void setRegion(String region) {
        this.region = region;
    }

    public String getAccessKey() {
        return accessKey;
    }

    public void setAccessKey(String accessKey) {
        this.accessKey = accessKey;
    }

    public String getSecretKey() {
        return secretKey;
    }

    public void setSecretKey(String secretKey) {
        this.secretKey = secretKey;
    }

    public String getBucket() {
        return bucket;
    }

    public void setBucket(String bucket) {
        this.bucket = bucket;
    }

    public Boolean getPathStyleAccess() {
        return pathStyleAccess;
    }

    public void setPathStyleAccess(Boolean pathStyleAccess) {
        this.pathStyleAccess = pathStyleAccess;
    }

    @Bean(destroyMethod = "close")
    public S3Client s3Client() {
        if (!"s3".equalsIgnoreCase(type)) {
            return null;
        }
        return S3Client.builder()
                .endpointOverride(java.net.URI.create(endpoint))
                .region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(accessKey, secretKey)))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(pathStyleAccess)
                        .build())
                .build();
    }
}
