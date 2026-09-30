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
RUN elasticsearch-plugin install --batch file:///tmp/ik.zip \
    && rm -f /tmp/ik.zip \
    && chown -R elasticsearch:elasticsearch /usr/share/elasticsearch/plugins
USER elasticsearch