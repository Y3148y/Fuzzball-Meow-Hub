# =====================================================================
#  毛球喵社 —— 前端镜像（多阶段构建）
#  构建上下文必须是 frontend/ 目录：docker build -t xiaoku-frontend frontend/
#
#  Stage 1（build）：node 20 装依赖 + 构建出纯静态 dist
#  Stage 2（runtime）：nginx alpine 托管静态资源 + 反代后端 /api 与 /static
#    前端代码里不写后端域名（开发靠 Vite proxy，生产靠这里是同一条路径）。
# =====================================================================
# syntax=docker/dockerfile:1

# 国内拉不到 docker.io 时可注入镜像加速前缀，例如
#   docker build --build-arg REGISTRY_PREFIX=docker.m.daocloud.io/ ... 
ARG REGISTRY_PREFIX=

FROM ${REGISTRY_PREFIX}node:20-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------------------------------------------------------------------
FROM ${REGISTRY_PREFIX}nginx:1.27-alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1