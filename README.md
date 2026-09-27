# 小哭猫 Xiaoku

> 一个前后端分离的「笔记社区」项目，用于准备 Java 后端开发岗位面试。
>
> **本项目为个人学习作品，与任何商业平台无任何关联。**
> 所有名称、界面、代码与数据均为原创；项目不抓取、不存储、不分发任何第三方平台的内容。

---

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 环境编排 + 工程骨架 | ✅ 已完成 `v0.1-env-skeleton` |
| P1 | 统一响应 / 全局异常 / 参数校验 / 雪花 ID | ✅ 已完成 |
| P2 | 用户模块 + JWT 鉴权 | ✅ 已完成 `v0.2-user-jwt` |
| P3 | 笔记发布 + 图片上传 | ⬜ 未开始 |
| P4 | 前端页面（登录 / 首页 / 发布 / 详情 / 我的） | ⬜ 未开始 |
| P5 | 点赞 / 收藏 / 评论 + Redis 计数一致性 | ⬜ 未开始 |
| P6 | 关注关系 + 关注流 | ⬜ 未开始 |
| P7 | Elasticsearch 搜索 + Kafka 异步同步 | ⬜ 未开始 |
| P8 | 缓存三件套 / 布隆过滤器 / 分布式锁 / 限流 | ⬜ 未开始 |
| P9 | 压测报告 + 完整文档 + 部署脚本 | ⬜ 未开始 |

> 完整 README（架构图 / ER 图 / 技术选型理由 / 难点攻坚 / 压测数据 / 面试话术）会在 P9 撰写。
> 届时每个阶段会打一个 git tag，形成「渐进式演进」的提交记录。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Spring Boot 3.5.3 / JDK 17 / Maven Wrapper 3.9.9 |
| 持久层 | MyBatis-Plus 3.5.17 + Druid 1.2.28 + MySQL 8.4 |
| 缓存 | Redis 7 + Redisson 3.52.0 |
| 消息队列 | Kafka 3.9.2（KRaft 模式，无 ZooKeeper） |
| 搜索 | Elasticsearch 8.17.6 |
| 对象存储 | 面向 S3 协议编程，可切换任意 S3 兼容服务 |
| 鉴权 | JWT (jjwt 0.12.6) |
| 接口文档 | Knife4j 4.5.0 + springdoc-openapi 2.9.1 |
| 前端 | Vue 3.5 + Vite 8 + TypeScript 6 + Pinia + Vue Router + Vant 4 |

---

## 快速开始

### 0. 前置条件

- JDK 17（`E:\JDK17\jdk-17.0.1` 或其他 17.x）
- Docker Desktop
- Node.js 20+

### 1. 启动中间件

```bash
docker compose up -d
docker compose ps
```

会启动三个服务：

| 服务 | 宿主机端口 | 说明 |
|---|---|---|
| MySQL | `3309` | 首次启动自动执行 `sql/schema.sql` 建库建表 |
| Kafka | `9092` | KRaft 模式单节点 |
| Elasticsearch | `9250` | 单节点，关闭安全认证 |

> **为什么端口不是默认的？** 本机 3306 / 9200 / 8080 / 8091 已被其他服务占用，故顺延。
> 端口可通过根目录 `.env` 修改。

> **国内网络拉取 Docker Hub 镜像：** 根目录 `.env` 里的 `REGISTRY_PREFIX` 已配置为
> `docker.m.daocloud.io/`。海外环境把它置空即可。

### 2. 启动后端

```bash
cd backend

# Windows
mvnw.cmd spring-boot:run

# macOS / Linux
./mvnw spring-boot:run
```

> IDEA 里请把 **Project SDK 设为 17**，**Maven 选 "Bundled"（3.9.6+）**。
> 系统自带的 Maven 3.6.1 低于 Spring Boot 3 要求的 3.6.3，会报错。

启动后：

- 接口文档 <http://localhost:8088/doc.html>
- 健康自检 <http://localhost:8088/api/system/ping>

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问 <http://localhost:5180>，首页会实时展示后端返回的雪花 ID。

> 前端 dev 端口 5180（5173~5176 已被占用）。`/api` 与 `/static` 由 Vite 代理到 `127.0.0.1:8088`。

---

## 目录结构

```
red-book/
├── docker-compose.yml      # MySQL + Kafka + Elasticsearch
├── .env                    # 镜像源前缀、端口、库口令
├── sql/schema.sql          # 建库建表
├── backend/                # Spring Boot 服务
│   └── src/main/
│       ├── java/com/xiaoku/
│       │   ├── common/     # 统一响应、异常、常量、配置、工具、上下文、拦截器
│       │   ├── controller/ # 系统接口
│       │   └── module/     # 业务模块（按领域分包：user / note / interaction ...）
│       └── resources/      # application*.yml
└── frontend/               # Vue 3 应用
    └── src/
        ├── api/            # Axios 封装
        ├── router/         # 路由
        ├── stores/         # Pinia
        └── views/          # 页面
```

业务模块统一按 `module/{领域}/{controller,service,mapper,entity,dto,vo,converter}` 分包，
领域之间只能通过 `service` 层互相调用，不允许跨模块直接摸对方的 `mapper`。

---

## P2 交付内容

### 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/user/register` | 免 | 注册，用户名唯一 |
| POST | `/api/user/login` | 免 | 登录，返回 accessToken(2h) + refreshToken(30d) |
| POST | `/api/user/refresh?refreshToken=` | 免 | 用 refreshToken 换新的 accessToken |
| GET | `/api/user/me` | 需 | 当前登录用户（走 Redis 缓存） |
| PUT | `/api/user/profile` | 需 | 部分更新个人资料 |
| GET | `/api/user/me/context` | 需 | 调试用：查看 ThreadLocal 注入的登录上下文 |

演示账号：`xiaoku_demo` / `Xk@123456`、`xiaoku_test` / `Xk@123456`
（仅 `dev` / `test` profile 下由 `DevDataInitializer` 创建）

### 关键设计

1. **白名单原则**：`AuthInterceptor` 只注册在非白名单路径上，缺 token 直接拒绝。
   白名单是「收紧的例外」，而不是「逐个加保护」——后者漏一个就是越权漏洞。
2. **access / refresh 分离**：短期 access 顶请求、长期 refresh 只用于换签；
   `typ` claim 强制校验类型，防止 refresh 被当 access 使用。
3. **BCrypt 存口令**：自适应代价 + 内嵌随机盐，同一口令每次密文都不同；
   登录失败时「用户不存在」与「口令错误」返回**同一个**错误码，避免被用来枚举用户。
4. **Entity 不出 Service**：Controller 一律返回 VO，`UserConverter` 显式转换，
   杜绝 `password` 意外泄漏到响应体。
5. **缓存只放读路径**：`UserQueryService` 独立承载 `@Cacheable` / `@CacheEvict`，
   写路径「先改库、再删缓存」。

---

## 已知的环境适配说明

这些是本机实测踩到的坑，均已在配置中处理并留注释：

1. **Maven 版本**：Spring Boot 3 要求 Maven ≥ 3.6.3，系统自带的 3.6.1 不满足，故引入 Maven Wrapper 3.9.9。
2. **MyBatis-Plus 3.5.9+ 拆包**：分页与全表更新阻断插件移到了独立模块 `mybatis-plus-jsqlparser`，需显式引入。
3. **springdoc 版本**：Knife4j 4.5.0 内置 springdoc 2.3.0，但 Maven 会解析到 3.x（面向 Spring Boot 4），不覆盖则启动失败。
4. **Kafka 监听器名称**：`listeners` 与 `advertised.listeners` 的名称集合必须一致，否则 broker 拒绝启动。
5. **Spring 6.1 的 404**：`NoResourceFoundException` 不再继承 `NoHandlerFoundException`，需单独处理，否则 404 会被兜底分支吞成「系统繁忙」。
6. **Lombok `@Data` 多出字段**：`isSuccess()` 会被 Jackson 当成属性序列化，需 `@JsonIgnore`。
7. **Docker Hub 直连不通**：已通过 `.env` 的 `REGISTRY_PREFIX` 走镜像源。
8. **Spring 6.2 移除 `setCacheErrorHandler`**：`AbstractCacheManager` 上已无该方法，
   `CacheErrorHandler` 改由 `CachingConfigurer#errorHandler()` 提供。
9. **`RedisCacheManagerBuilder` 没有 `disableCachingNullValues()`**：
   该配置只在 `RedisCacheConfiguration` 上，builder 上的同名方法在 3.5.x 已移除。
10. **漏写 `@EnableCaching` 的代价**：Spring Boot 只自动配置 `CacheManager`，
    注册 `CacheInterceptor` 要靠这个注解。漏掉时**不报错、不告警**，`@Cacheable` 静默失效。
11. **Lombok `@Builder` 会顶掉 `@Data` 的构造器**：`@Data + @Builder` 的类**没有无参构造**，
    Jackson 无法反序列化，缓存「写得进、读不出」。凡是被 Redis / MQ 序列化的类都要显式补 `@NoArgsConstructor`。
12. **`transactionAware()` 对「删缓存」策略是负收益**：它把 evict 延迟到事务提交，
    导致同一事务内「改库 → 删缓存 → 读缓存」读到旧值，接口返回没生效的改动。
    它只在「更新缓存」策略下才有意义。
13. **`selectCount` 返回 0 而不是 null**：`if (count != null)` 判重永远为真，
    所有注册都会误报「用户名已被占用」。必须写 `count != null && count > 0`。
14. **同类自调用绕过 Spring 代理**：类内 `this.getUserVO()` 不会触发 `@Cacheable`，
    带缓存注解的方法要抽到独立 Bean 里。
