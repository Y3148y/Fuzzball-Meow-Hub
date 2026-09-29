# =====================================================================
#  毛球喵社 —— 后端镜像（多阶段构建）
#  构建上下文必须是 backend/ 目录：docker build -t xiaoku-backend backend/
#
#  Stage 1（build）：maven 官方镜像带 JDK17 + Maven 3.9.x，
#    直接跑 mvn 而不是 ./mvnw —— mvnw 首次运行要从 Maven Central 拉 wrapper
#    发行包，容器里反正有现成 maven，省一次下载也少一个失败点。
#  Stage 2（runtime）：最小 JRE，非 root 用户跑，健康检查用 curl。
# =====================================================================

# syntax=docker/dockerfile:1

# 国内拉不到 docker.io 时可注入镜像加速前缀，例如
#   docker build --build-arg REGISTRY_PREFIX=docker.m.daocloud.io/ ... 
ARG REGISTRY_PREFIX=

FROM ${REGISTRY_PREFIX}maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /build

# 只拷 pom 先解析依赖，源码变动时能复用依赖层缓存
COPY pom.xml ./
COPY mvnw ./
RUN mvn -q -B dependency:go-offline || true

COPY src ./src
# 跳过测试：单元测试不塞进镜像构建；质量门在仓库里的契约/CDP 测试
RUN mvn -q -B -DskipTests package

# ---------------------------------------------------------------------
FROM ${REGISTRY_PREFIX}eclipse-temurin:17-jre
WORKDIR /app

ENV TZ=Asia/Shanghai

# 健康检查需要 curl；jre 镜像不带，装上
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app -u 1001 app \
    && mkdir -p /app/uploads /app/logs \
    && chown -R app:app /app

COPY --from=build /build/target/xiaoku-backend.jar /app/app.jar

USER app
EXPOSE 8088

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8088/api/system/ping || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-Dfile.encoding=UTF-8", "-jar", "/app/app.jar"]