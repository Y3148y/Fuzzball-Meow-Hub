# =============================================================
#  Elasticsearch 8.17.6 + IK 中文分词插件
#
#  用法：在 elasticsearch 服务上同时给 `image:` 和 `build:` 两个键：
#    - 开发：docker-compose.yml 里 build 的 context 指向 ./deploy/es
#    - 生产：deploy/docker-compose.prod.yml 里 build 的 context 指向 ./es
#  compose 会用本地镜像（tag 仍取 image 的名字），重新 up 即生效。
#
#  素材：ik/elasticsearch-analysis-ik-8.17.6.zip（infinilabs 发行，与 8.17.6
#  descriptor 匹配），已下载在本目录且被 .gitignore 排除，不入库。
#  换 ES 小版本记得同步换 zip 并核对 descriptor。
# =============================================================
ARG BASE_IMAGE=docker.elastic.co/elasticsearch/elasticsearch:8.17.6
FROM ${BASE_IMAGE}

# 基础镜像末尾切到了 elasticsearch 用户，装插件要写 plugins/，先回 root；
# 装完把产物还给 elasticsearch，运行时才不会因磁盘权限起不来
USER root
COPY ik/elasticsearch-analysis-ik-8.17.6.zip /tmp/ik.zip
# 先 remove 再 install：这一步必须**可重入**。BuildKit 按命令字符串缓存，改过
# 这条 RUN 之后缓存会 miss，于是它在「已经装过插件」的旧层上重跑，于是报
# `plugin directory [analysis-ik] already exists`（2026-10-04 撞过）。
# remove 对没装过的镜像会失败，所以 || true 吃掉它。
RUN elasticsearch-plugin remove analysis-ik || true \
    && elasticsearch-plugin install --batch file:///tmp/ik.zip \
    && rm -f /tmp/ik.zip \
    && chown -R elasticsearch:elasticsearch /usr/share/elasticsearch/plugins
USER elasticsearch