# 毛球喵社 Fuzzball-Meow-Hub

> 一个前后端分离的「笔记社区」项目，用于准备 Java 后端开发岗位面试。
>
> **本项目为个人学习作品，与任何商业平台无任何关联。**
> 所有名称、界面、代码与数据均为原创；项目不抓取、不存储、不分发任何第三方平台的内容。

**命名说明**：产品 / 社区名为「毛球喵社」（对应仓库名 `Fuzzball-Meow-Hub`）；
吉祥物名为「小哭猫 Xiaoku」（代码包名 `com.xiaoku` 与 demo 账号 `xiaoku_demo` 均沿用该代号，
指代吉祥物本身而非平台）。类比 GitHub 之于 Octocat。

---

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 环境编排 + 工程骨架 | ✅ 已完成 `v0.1-env-skeleton` |
| P1 | 统一响应 / 全局异常 / 参数校验 / 雪花 ID | ✅ 已完成 |
| P2 | 用户模块 + JWT 鉴权 | ✅ 已完成 `v0.2-user-jwt` |
| P3 | 笔记发布 + 图片上传 | ✅ 已完成 |
| P4 | 前端页面（登录 / 首页 / 发布 / 详情 / 我的） | ✅ 已完成 |
| P5 | 点赞 / 收藏 / 评论 | ✅ 已完成 |
| P6 | 关注关系 + 关注流 | ✅ 已完成 |
| P7 | Elasticsearch 搜索 + Kafka 异步同步 | ✅ 已完成 |
| P8 | 限流 / 幂等 / 布隆过滤器 / 分布式锁 / Redis 计数权威 + 异步落库 | ✅ 已完成 |
| P9 | 压测报告 + 完整文档 + 部署脚本 | ✅ 已完成 |
| P10 | 笔记编辑/上下架 + 评论点赞 + IK 分词 + 补 git tag + 清理压测残留 | ✅ 已完成 |
| P11 | 作者自评放开 + 图文必带图 + 删除笔记 + 作者操作 UI | ✅ 已完成 |

> 架构图 / ER 图 / 部署脚本 / 压测数据都在「P9」节；git tag 见各版本提交记录（P10 补全 v0.3–v0.9，P11 收官 v1.0）。

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

### 1. 准备 `.env`

仓库不提供 `.env`（里面有口令），先从模板复制一份：

```bash
cp .env.example .env
```

然后填上 `MYSQL_ROOT_PASSWORD`（自己取一个值）。

> 为什么口令必须由你自己定：本项目的 MySQL 端口曾以硬编码默认口令启动，
> 仓库一旦公开就等于公开了开发库口令。现在 compose 用 `${VAR:?提示}` 语法，
> 未设置会**直接启动失败并打印提示**，不会静默套用弱口令。

### 2. 启动中间件

```bash
docker compose up -d
docker compose ps
```

会启动三个服务：

| 服务 | 宿主机端口 | 说明 |
|---|---|---|
| MySQL | `3309` | 首次启动自动执行 `sql/schema.sql` 建库建表；**仅绑定 `127.0.0.1`** |
| Kafka | `9092` | KRaft 模式单节点 |
| Elasticsearch | `9250` | 单节点，关闭安全认证 |

> **为什么端口不是默认的？** 本机 3306 / 9200 / 8080 / 8091 已被其他服务占用，故顺延。
> 端口可通过根目录 `.env` 修改。

> **国内网络拉取 Docker Hub 镜像：** 根目录 `.env` 里的 `REGISTRY_PREFIX` 已配置为
> `docker.m.daocloud.io/`。海外环境把它置空即可。

### 3. 启动后端

后端**不会**内置库口令，启动前需把它作为环境变量传进来（取值同 `.env` 的 `MYSQL_ROOT_PASSWORD`）：

```powershell
# Windows PowerShell
$env:XK_MYSQL_PASSWORD = "<你在 .env 里填的值>"
```

```bash
# macOS / Linux
export XK_MYSQL_PASSWORD="<你在 .env 里填的值>"
```

```bash
cd backend

# Windows
mvnw.cmd spring-boot:run

# macOS / Linux
./mvnw spring-boot:run
```

> 忘记设会怎样：启动阶段直接失败并报
> `Could not resolve placeholder 'XK_MYSQL_PASSWORD'`，不会静默连上或连错库。
> 运行后端测试（`mvn test`）同理需要这个变量。

> IDEA 里请把 **Project SDK 设为 17**，**Maven 选 "Bundled"（3.9.6+）**。
> 系统自带的 Maven 3.6.1 低于 Spring Boot 3 要求的 3.6.3，会报错。

启动后：

- 接口文档 <http://localhost:8088/doc.html>
- 健康自检 <http://localhost:8088/api/system/ping>

### 4. 启动前端

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
15. **`computed` 里读 `localStorage` 会永久缓存**：Vue 的 `computed` 只在被追踪的响应式源变化时重算，
    而 `localStorage` 不是响应式源，`computed(() => localStorage.getItem('token'))` 算一次就再也不更新 ——
    表现为「登录成功后立刻被路由守卫弹回登录页」。正解是把 token 放进 `ref`，
    用 `watch` 负责持久化，让状态源本身变成响应式。
16. **Axios 响应拦截器解包后，调用方不能再读 `res.data`**：拦截器里 `return body.data` 已经把信封拆了，
    业务代码再 `res.data` 恒为 `undefined`。这个坑最隐蔽的地方在于「成功被当成失败」——
    刷新 token 明明成功，却走进失败分支把用户踢下线，正好是该机制要防的事。
    解法：给刷新接口单独开一个不带拦截器的裸 client，自己解析 `{code, data}`。
17. **提交按钮 `disabled` 却不给理由**：把「字段长度不够」也算进 `canSubmit`，
    用户点了没反应，也永远看不到「密码长度要在 8~20 之间」到底错在哪。按钮应只在 `loading` 时禁用。
18. **Vite 8 / Rollup 5 的 `manualChunks` 只保留函数签名**：`{ vue: ['vue'] }` 对象写法运行时仍可用，
    但 `vue-tsc` 报 TS2769，会让 `npm run build` 整体失败。改成函数形式。
19. **`erasableSyntaxOnly` 禁用构造函数参数属性**：`class X { constructor(readonly a: number) {} }`
    在 TS 6 下报 TS1294，字段要拆成显式声明 + 赋值。
20. **逻辑删除不释放唯一索引**：`user.uk_username` 不含 `deleted` 列，
    所以 `UPDATE user SET deleted=1` 之后**用户名仍被占用**，再注册同名会先撞判重、否则撞唯一索引。
    清理测试数据要用物理 `DELETE`。

---

## 前端登录链路复盘

> 登录/首页原本排在 P4，为了尽早验证「鉴权闭环」提前做了。
> P4 仍需补发布、详情、我的等页面。

### 三个真实 bug

这三个都是**读代码看不出来、真机点出来才暴露**的，且都通过了 `vue-tsc` 与生产构建。

| # | 现象 | 根因 | 为什么静态检查抓不到 |
|---|---|---|---|
| 1 | 登录成功后被守卫弹回登录页 | `isLogin` 是 `computed(() => localStorage…)`，而 `localStorage` 非响应式源，`computed` 算一次就永久缓存 | TS 只管类型，`localStorage` 读取完全合法 |
| 2 | access token 正常过期时用户被踢下线 | 响应拦截器已解包成 `body.data`，刷新逻辑又读 `res.data` 得 `undefined` → 走失败分支 | 成功路径和失败路径类型都是合法的 |
| 3 | 填错密码时点登录毫无反应 | `canSubmit` 把「长度不够」也算作按钮 `disabled` | 不是错误，是设计选择 |

**防复发**：登录链路一旦改动，跑 `npm run test:ui`（184 条断言，见下）。第 1、2 条都有对应用例。

### 测试基建：`npm run test:ui`

用 Node 22 自带的 `WebSocket` 直接说 Chrome DevTools 协议驱动真实浏览器，
不引入 Playwright（为几条断言拉几十 MB 依赖不划算）。

| 脚本 | 覆盖 |
|---|---|
| `npm run test:ui:smoke` | 守卫拦截、吉祥物解码、CSS token、演示登录、双 token 落库、刷新保持登录、深浅模式与持久化、退出、注册、前端校验 |
| `npm run test:ui:refresh` | 坏 access 自动 refresh + 重放原请求、双 token 同步轮换、双 token 失效清理、无 refresh 安全降级 |
| `npm run test:ui:note` | 发布页守卫、空表单禁用、字数计数、本地预览、9 张上限、发布跳详情、详情图片**真实解码**（非碎图）、**P11 起作者操作区：编辑回填/保存、上架·下架切换、删除二次确认→回首页→20001** |
| `npm run test:ui:profile` | 我的页守卫、资料回填、昵称超长前端拦截、保存后**回查后端**确认落库、取消不写库、演示账号自还原 |
| `npm run test:ui:interaction` | 点赞/收藏开关往返、两者互不影响、并发复位收敛、跨账号评论、回复嵌套与被回复者昵称、**评论点赞开关往返（根评论与回复）**、删根评论的确认弹窗与子树级联 |
| `npm run test:ui:follow` | 作者主页关注 → 关注流出现 → 详情页取关 → 关注流消失、行内关注按钮、关注/粉丝列表、粉丝空态、自己主页无关注按钮 |
| `npm run test:ui:search` | 首页搜索框跳搜索页、命中素材笔记、卡片作者昵称来自 MySQL 回填、进详情、无结果空态、空关键词不发请求、带 `?keyword=` 直链刷新 |
| `npm run test:ui:idempotent` | 幂等 key 随请求存活期滚动、坏 access 触发 refresh 时幂等头不丢、手动改坏 token 精确模拟 401 |
| `npm run test:ui` | 八者全跑（184 条） |

**验证 refresh 链路的做法**：把 `localStorage` 里的 `xk_token` 改成垃圾串后**整页重载**。
冷启动时 token 的 `ref` 会读到这个坏值，`isLogin` 仍为 `true`，
于是 `/me` 必然返回 10006，正好触发「刷新 → 重放」这条路径。

写这类测试时踩到的三个坑（都写进了 `scripts/ui-cdp.mjs` 的注释）：

1. **`Page.navigate` 到完全相同的 URL 只做 hash 片段跳转，不会重新执行文档。**
   一开始没做强制重载，导致「改 localStorage 制造冷启动」完全无效，
   整个 refresh 用例是**假通过**。现在先跳 `about:blank` 再跳回来。
2. **断言「元素非空」会中计**：昵称未加载时是占位符「加载中…」，同样是非空文本。
   必须断言等于真实昵称，否则会在往返完成之前就误判成功。
3. **Windows 上 `kill()` 后立刻删临时目录必然失败**：文件锁还没释放，`rmSync` 静默失败，
   跑一次漏一个几十 MB 目录。现在等进程真正退出再删，并带重试。

### P3 笔记域：踩过的两个坑

**1. 雪花 ID 必须是字符串（契约测试抓出来的真实缺陷）**

```
后端 ID  = 362756654342606850      10^17 量级
JS 解析后 = 362756654342606848      JSON.parse 静默四舍五入
```

JS 的 `Number.MAX_SAFE_INTEGER` 只有 `9007199254740991`（约 9.007×10^15），
超出后**不抛错、不告警**，只是数悄悄变了。表现是「发布成功了，
拿返回的 id 查详情却提示笔记不存在」——因为回传的根本是另一个数。

修法是 `JacksonConfig` 把 `Long` 一律序列化成字符串，配套三点：

- **只定制 Spring MVC 的 `ObjectMapper`。** `RedisObjectMapperProvider` 是另一个实例
  且带 `activateDefaultTyping`，缓存里落成字符串后反序列化回 `UserVO` 会类型不匹配。
- **非 ID 的数值别用 `Long`。** `LoginVO.expiresIn` 原本是 `Long`，被这条规则波及成了
  字符串，改成 `Integer` 才对——它是时长不是 ID。
- 前端 `types.ts` 用 `SnowflakeId = string`，赋值时不要 `Number()` / `parseInt`。

**2. 图片不能一次性和正文一起提交**

「multipart 一次带正文 + 9 张图」看着省事，但图片存到第 5 张失败时，
已经落盘的前 4 张没法回滚，只能留成孤儿文件。
所以拆成两步：`POST /api/note/image` 先换 URL，`POST /api/note/publish` 再提交 URL 列表。
「上传了但没发布」产生的孤儿文件，由 P9 的定时任务清理，不阻塞主流程。

顺带两个安全细节：上传文件名**一律服务端生成 UUID**、扩展名按 content type 白名单反推
（原始文件名是用户可控输入，直接拼路径会同时踩到路径穿越和扩展名伪装）；
发布时校验图片地址只放行站内相对路径与 `http(s)`，否则 `javascript:` 存进库后
渲染成 `<img src>` 就是 XSS。

### P4「我的」页：空串不是 null

改资料时我先按"只发改动的字段"的直觉写了提交逻辑：

```ts
if (trimmedBio) patch.bio = trimmedBio   // ← 错
```

结果**用户永远清不掉自己的简介**。后端 `UserServiceImpl.updateProfile` 用的是
MyBatis-Plus 的 `update-strategy: not_null`，所以这里有两种完全不同的语义：

| 前端发的东西 | 落到 UPDATE 里 | 效果 |
|---|---|---|
| 不传 `bio`（undefined → JSON 里没有这个 key） | 字段被剔除 | **保持**原简介 |
| `bio: null` | 字段被剔除（`not_null` 剔的是 null） | **保持**原简介 |
| `bio: ''` | 字段保留 | **清空**简介 |

改法是 `bio` 无条件提交（含空串），只有 `nickname` 才做非空判断（昵称本来就必填）。

顺带一个推论值得记住：**`bio` 一旦被写成 `''` 就再也回不到 `NULL` 了**，
因为传 `null` 会被 `not_null` 剔掉。列是 `VARCHAR(255) DEFAULT NULL`，
UI 上两者都是 falsy 不影响显示，但 fixture 的初始状态确实会被测试改掉，
所以 `ui-profile.mjs` 的还原是拿原值比对的，不是硬写空串。

### 断言要落在"后端"上，不是"页面上"

保存资料后立刻断言页面显示对不对是没意义的 —— 页面上显示的就是刚 set 进去的那个
store 对象，怎么都"对"。所以 `ui-profile.mjs` 改完之后**重新 GET 一次 `/user/me`**，
比对 nickname / bio / gender 三个字段是否真的进了 MySQL。

同理，测试收尾的还原动作**刻意走接口而不是再点一遍表单**：
清理不该依赖被测对象本身，否则哪天保存逻辑坏了，UI 清理会跟着一起失败，
留下一条昵称被改坏的 fixture 污染后面所有测试（`ui-smoke` 断言的就是「小哭猫」）。

### P5 互动域：三个只有真机点出来才发现的问题

**1. `get()` 的第二个形参不是 axios config**

`request.ts` 里的封装是 `get(url, params, config)` —— **第二个形参直接就是 query 参数**。
写 `get('/comment/list', { params: { noteId, page, size } })` 语法完全合法、
`vue-tsc` 也不会报错，但 axios 会把整个 `{ params: {...} }` 当成**一个** query 参数序列化，
实际发出的是 `?params[noteId]=...&params[page]=...`，
后端收到的就是「缺少必要参数：noteId」。

契约测试**抓不到**这个错，因为它走裸 HTTP 绕开了整个前端封装层。
只有真正驱动浏览器点「发评论」才会暴露。已写进 `api/comment.ts` 的注释里。

**2. `PageVO` 的 `total` 用 `long` 会被序列化成字符串**

P3 为了雪花 ID 定了「`Long` 一律序列化成字符串」的全局规则，
它连计数一起波及了：`total` 原本是 `long`，于是接口返回 `{"total": "1"}`，
前端 `total === 1` 恒为 false、分页器算不出总页数。改成 `Integer` 才是数字。
（`IPage.getTotal()` 是 `long`，用 `Math.toIntExact` 收——强转会静默截断成 0。）

**3. `non_null` 让「null」在 JSON 里变成「字段不存在」**

`application.yml` 配了 `default-property-inclusion: non_null`，
所以评论 VO 里「无父级」的 `parentId` 实际在 JSON 里**整个消失**，
前端拿到的是 `undefined` 而不是 `null`。判断「有没有值」必须用 `== null`，
写 `=== null` 会永远走进「有值」那个分支。已记进 `types.ts` 的 `Nullable<T>`。

顺带两个设计决定：

- **P5 时的计数实现：DB 自增 + 唯一索引当裁判，Redis 计数一致性推到 P8。** 计数用
  `UPDATE note SET like_count = like_count + 1` 原子自增，不做读-改-写；
  「先查有没有点赞再 insert」那种 check-then-act 会被并发打穿，
  这里只 insert、让 `uk_user_note` 唯一索引当唯一裁判。
  <b>P8 已推翻「DB 列即权威」</b>：列改成一号备份，读与写都以 Redis ZSet 为裁判
  （见下方 P8 段），但「唯一索引当裁判」这条没动。
- **`0` 哨兵不往外暴露。** 库里 `parent_id` 用 `0` 表示「无父级」，
  但这两个字段是 `Long`，序列化后是字符串 `"0"`，前端既不能 `Number()` 转
  （非零时是 17 位雪花 ID，一转丢精度），又容易和「ID 就是 0」混淆。
  所以 `CommentConverter` 读出来就转 `null`。

### P6 关注域：三个决策和一个真实缺陷

**1. 关注/取关走「物理删」而不是软删**

`user_follow` 表建表时就留了 `status` 列和「保留行以便追溯历史」的意图，
P6 做增删接口时决定放弃：关注本质上是一条「现在有效」的关系，取关后留着一行
失效数据，既要查 `status=1` 又要防 `uk` 判定，还让计数、列表、feed 全都要带条件。
物理删 + schema 里那个本意是软删的 `status` 列**闲置不用**（列留着，语义弃用）。

唯一索引 `uk_user_follow(user_id, follow_id)` 当唯一裁判，和 P5 的点赞同款：
不先查后写，直接 `insert`，撞了就是 40001「已关注」。

**2. 关注数与粉丝数的原子加减**

`update follow_count = GREATEST(0, follow_count + 1)`。
`GREATEST` 拦边界：并发取关时 0 不能再往下跌成负数。
列表里 `followed` 字段的含义是「**当前浏览者**是否也关注了这一行」，不是
「TA 和列表主人什么关系」——这个概念不写清，接口和前端测试都会写反
（契约测试第一版就写反过，见下）。

**3. `NoteVO` 增加 `authorId`——刻意反转的决定**

P4 做详情页时**故意不**在 `NoteVO` 里暴露作者 ID，理由写在注释里：
详情页展示只需要昵称，作者关系靠「我的」页独立查询。
P6 要做「详情页直接关注作者」，发现没有 `authorId` 就得为了一个按钮专门
再发一次「查作者」的请求。于是反转：
`NoteVO` 现在带 `authorId` 和 `authorFollowed`（当前登录者是否已关注作者）。
后端、`types.ts`、契约断言三处注释都对得上——改任一侧，另外两处会立刻炸出来。

**4. `followed` 是视图态，不能进被缓存的 `UserVO`**

`UserVO` 按 userId 缓存，而「我关注了 TA 吗」因人而异、逐请求现算。
把 `followed` 塞进 `UserVO` 等于让缓存带上浏览者指纹，纯给自己挖坑。
单独一个新类型 `FollowUserVO`（UserVO 字段 + `followed`）说清楚这事。
作者卡片（`GET /api/follow/user/{id}`）也复用它，一次往返拿全。

**5. feed 用 JOIN 而不是先查 IDs 再 IN**

「我关注的作者的笔记」最直觉的写法是两次查询：先查 followings，再
`IN (...)` 查笔记。但 follow list 随手可及几万行，IN 进去是灾难。
一次 `INNER JOIN user_follow ON note.user_id = follow_id AND user_id = me`
直接把「关系即视野」翻译成 SQL，列表天然只含关注中的人，好理解也好维护。

**6. 一个真实缺陷：`viewer 看别人关系页时 followed 语义写反**

契约测试第一版断言「看 TA 的关注列表，行内 followed 应为 true」，
跑挂了才意识到这个字段问的是「**我**关注了你没有」，和 TA 无关。
这属于「设计意图没落地成断言就没人会真的读注释」的典型——
写进契约里一次，以后谁想改语义都会被红叉拦住。

前端对应实现里还有两个值得一提的坑：

- **`UserView.isSelf` 必须用 `computed`**：写死成 `const isSelf = !!user && id===id`，
  在用户资料还没拉回来的那一瞬间求值成 `false`，自己主页也会短暂出现「关注」
  按钮，之后又消失——不是逻辑错，是「一次性求值」对异步加载不成立。
- **关注/取关按钮沿用详情页点赞的范式**：busy 标记挡连点、
  状态用后端返回值写回、40001/40002（本地与后端不同步）静默重拉纠正。
  除了详情页，首页关注流的行内按钮、关注/粉丝列表页、作者主页共用同一套。

CDP 的 `ui-follow.mjs` 有个自愈细节：全程只可能产生 demo→素材号 一条关注关系，
脚本开头先去作者主页把残留状态归零再断言「不在关注流」，
这样中途崩掉的上一次运行不会让下一次跑红。

### P7 搜索域：ES 只做检索，卡片回 MySQL 组装

**1. 一个真实的脚手架缺陷：producer 缺 `bootstrap.servers`**

P0 的 `KafkaConfig` 手写 `ProducerFactory` 的 config map，只塞了序列化器等键，
**漏了从 `spring.kafka.*` 读 `bootstrap.servers`**。启动阶段完全不报错，
直到第一次真发消息才抛 `No resolvable bootstrap urls given in bootstrap.servers`。
修法是 `kafkaProperties.buildProducerProperties(null)` 打底再覆盖自有键——
别再手写那串 map。这类「配置在启动时被放过、在首个请求才暴露」的坑，
只有真发一条消息才能抓到。

**2. 发布 → Kafka → ES 全异步，索引只是检索层**

`NoteServiceImpl.publish` 在事务 **afterCommit** 才发 `NoteEventDTO`
（key = noteId，发送失败只记日志、绝不阻塞发布本身）。消费端 `xk-search` 组
按「先删后建」upsert，`_id` 直接用 noteId，天然幂等、可重放。

ES 文档只存**检索字段**（id / title / content / type / status / userId / createTime），
命中后回 MySQL `selectBatchIds` 组装卡片——昵称、计数、`authorFollowed` 都是**当前值**，
不会因为 ES 里是发布时的快照而过期。返回顺序严格保 ES 的相关度/时间序：回填后按 id 映射重排。

**3. 计数不进 ES，漂移留到 P8**

点赞/收藏/评论数变化**不触发**重建索引（P7 只做发布快照 + reindex 兜底），
卡片计数由回 MySQL 时现查所以始终准；真正的实时计数一致性（Redis 计数 + 异步落库）
是 P8 的主题，这里不提前实现。

**4. Snowflake ID 在 ES 里也是字符串**

`NoteEventDTO` 的 id 用 `String`（生产者复用 Spring MVC 的 ObjectMapper，Long → 字符串），
文档 `_id` 直接用它。按数字存会和 P3 一样丢精度——ES 的 `long` 是安全的，
但事件一路从 JSON 过来，中间任何一次 JS/字符串转换都不能变数字。

**5. DLT 兜底**

消费失败经 `FixedBackOff(1s, 3)` 重试后进 `<topic>.DLT`（`DeadLetterPublishingRecoverer`），
坏消息不卡分区。

**已知缺口**：本机无 S3 端点，`S3ImageStorage` 仍未实测。
（IK 分词已在 P10 接入：自建 ES 镜像装 analysis-ik，索引用 `ik_max_word` + 查询 `ik_smart`。）

### P11 小红书对齐：三处语义与一个删除模型

小红书一线上有三条约定之前是「明显不一致」，P11 一次拉齐：

| 改动 | 之前 | 之后 |
|---|---|---|
| **作者自评** | `30007 不能评论自己的笔记` 直接拒 | 自评 / 自回复合法（枚举保留，检查移除） |
| **图文必带图** | publish 允许没图 | 发布调用 `validatePublishParams(dto, true)`：缺/空/空组 `imageUrls` 一律 `10001`；编辑仍传 `false`，保留「把图清空」的 P10 语义 |
| **删除笔记** | 没有删除接口 | `DELETE /api/note/{id}`，见下 |

**删除模型**，刻意做成「物理删 + 事件驱动清两侧」：

- 权限：作者本人；非作者 / 不存在一律 `20001` —— 不区分「没有」和「不能」，防探测笔记 ID。
- 事务内级联顺序 `comment_like → comment → note_like → note_collect → note_image → note`，与契约测试清理 SQL、`schema.sql` 的外键层级一致。
- `afterCommit` 发 `ACTION_DELETE` 事件，消费者 `deleteById` 清 ES 文档（异步，搜索约 1 秒内消失）。
- Redis 由 `NoteCounterStore.removeCounters` 清该笔记的 ZSet / dirty 键（fail-open：失败了下次脏键检查会自动重建，不会把全站计数带崩）。
- **图片文件本体不删**：`backend/uploads/` 已 gitignore，文件随进程留着即可，要清就整目录删。这是「删除语义」和「磁盘回收」刻意解耦——将来做 S3 时删除策略由存储层决定，接口层不掺和。

前端配套：详情页作者操作区（编辑 / 上下架 / 删除，删除有 Vant 二次确认）+ 新路由 `/edit/:id` 的 `NoteEditView`（编列式图片列表，可移除旧图、新图即选即传，保存全量覆盖）。

### 后端契约测试：`node backend/scripts/contract-test.mjs`

P2 那 7 条断言原本是临时脚本，跑完就丢了，`git log` 里看不出「怎么测的」。
现在固化成落盘的契约快照，355 条（P2 44 + P3 32 + P5 58 + P6 69 + P7 19 + P8 54 + P10 56 + P11 23）：

```bash
cd backend
node scripts/contract-test.mjs          # 默认打 localhost:8088
XK_API_BASE=http://ip:8088 node scripts/contract-test.mjs   # 换地址
```

**为什么不用 JUnit / RestAssured / Testcontainers**：
这一层要验的是「HTTP 报文长什么样」——业务码、错误码、双 token 轮换、鉴权白名单、
VO 有没有漏出敏感字段。裸 HTTP 打一遍最直接，零依赖意味着任何人不装 Maven 插件、
不起容器也能跑。service 层的分支测试留给后续按需引入 Mockito。

覆盖的分组：

| 组 | 断言要点 |
|---|---|
| 鉴权 | 白名单（ping/register/login/refresh）免 token；其余默认全部 10005；坏 token 10006 |
| 参数校验 | 用户名长度/字符集、口令长度、昵称超长、性别越界 → 100001 且 message 具体 |
| 登录 | 口令错与用户不存在**返回同一个码和同一句提示**（防用户名枚举） |
| token | 双 token 签发、access 拒当 refresh 用、refresh 轮换、access 当 refresh 用被拒 |
| 契约形状 | `UserVO` 不含 `password` / `status` / `deleted`，未传 nickname 回落 username |
| P3 笔记域 | 图片类型白名单、空文件、**落盘文件名由服务端生成**、静态资源可回读、9 张边界两侧、10 张越界用专用码 20004、`javascript:`/`data:` URL 被拒、未登录三接口、查无此笔记 20001 |
| P5 互动域 | 点赞/收藏各自开关往返、重复与未互动用专用码 30001~30004、**两套关系互不影响**、下架/草稿笔记拒绝互动 |
| P5 评论域 | ~~不能评论自己的笔记 30007~~（**P11 起作者可自评，枚举保留不删，分支已放开**）、回复拉平到同一根评论、**子回复截断到 3 条但 replyTotal 给真实总数**、级联删根评论且计数一次退完、非作者删除返回 30005 |
| P6 关注域 | 关注/取关各自开关注并重复操作 40001/40002、自关注 40003、目标不存在 10001、**关注/粉丝列表的 followed 是「当前浏览者是否也关注」**、互关后两列表都有 true、作者主页笔记列表 20001 区分「无笔记」与「用户不存在」、作者卡片一次往返拿全、feed 只含关注中作者的笔记、**取关后计数回滚且从 feed 消失** |
| P6 feed | JOIN 不 IN、列表含作者信息、空 feed、分页回显、未登录 10005 |
| P7 搜索域 | 空关键词 50002、未登录 10005、发布后**轮询等异步入索引**再断命中、命中首条就是种子笔记、卡片作者昵称来自 MySQL 回填、`authorFollowed` 为当前值、`total` 与 `list` 长度一致、无关词返回空列表不报错、分页回显、`/api/search/reindex` 重建后仍可搜到 |
| P10 编辑/上下架 | 空标题/图片清空（cover 与 videoUrl 置 null）后不回退、非作者编辑/下架 100001、status 只认 1|2（0 走 100001）、**下架→搜索消失、上架→恢复可搜**（真实 Kafka 链路）、作者主页对已下架笔记 status=2 可见、他人主页不含、重复下架幂等 |
| P10 评论点赞 | 开关往返各自生效、重复赞 30001 / 未赞取消 30002、**下架笔记的评论点赞被拒 20002 但取消不被拦**（规避 P5 回滚坑）、列表 `liked` 状态走 IN 批量判定、计数加减正确 |
| P11 图文明文 | 作者自评/自回复成功且 commentCount 同步、**图文不带图（缺/空/空组 imageUrls）一律 10001**、上架态发布后他人可见 |
| P11 删除 | 作者删除全链（发布→互动→评论→点赞→删除）、非作者/不存在一律 20001 防探测、**重复删 20001**、作者主页消失、**已删笔记的评论列表返回 20001**、ES 轮询消失（真实 Kafka `ACTION_DELETE`） |

最后一条是安全断言：Entity 有 `password`，靠 `@JsonIgnore` 兜底属于「靠注解赌后人不忘」，
断言字段名才能在有人不小心把 Entity 直接返回时立刻炸出来。

**写这个脚本时踩到的坑**：一开始断言「登录口令过短返回 100001」，
用 `Xk@1234567`（10 位）实际落在 8~20 区间内，校验通过后走到 service 层返回 10002 ——
断言写错了，不是代码错了。改 6 位才真正命中校验分支。

### 测试账号策略

注册冒烟用**固定**用户名 `xk_ui_smoke`（不用时间戳），
后端返回 `10003 用户名已被占用` 时同样判为通过 —— 请求确实打到了后端并走完校验与唯一索引。
这样库里恒为一条常驻 fixture 可供后续复用，不会随运行次数无上限增长。

后端契约测试相反：它需要每次一个**全新**账号（否则撞 `10003` 就测不到注册成功分支），
所以用 `ct_<时间戳>` 随机后缀，代价是每次跑留 3 个账号和它们的笔记。
脚本结束时会直接打出带具体 id 的清理 SQL。批量清（**顺序和范围都有讲究**）：

```sql
-- 0) 先用 ct 账号 id 把范围缩到测试笔记，别碰 fixture（demo / xk_ui_*）
--    下面每个子查询都锚在 ^ct[0-9]?_[a-z0-9]+$ 上，不是全表 DELETE
-- 1) 先子表后父表。P5 之后有四张表挂在 note 下面，
--    comment_like 又挂在 comment 下面，少删一张就留孤儿行
DELETE FROM xiaoku_db.comment_like
  WHERE comment_id IN (SELECT id FROM xiaoku_db.comment WHERE note_id IN
    (SELECT id FROM xiaoku_db.note WHERE user_id IN
      (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$')));
DELETE FROM xiaoku_db.comment WHERE note_id IN
  (SELECT id FROM xiaoku_db.note WHERE user_id IN
    (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$'));
DELETE FROM xiaoku_db.note_like   WHERE note_id IN
  (SELECT id FROM xiaoku_db.note WHERE user_id IN
    (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$'));
DELETE FROM xiaoku_db.note_collect WHERE note_id IN
  (SELECT id FROM xiaoku_db.note WHERE user_id IN
    (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$'));
DELETE FROM xiaoku_db.note_image  WHERE note_id IN
  (SELECT id FROM xiaoku_db.note WHERE user_id IN
    (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$'));
DELETE FROM xiaoku_db.note WHERE user_id IN
  (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$');
-- 2) user_follow 挂在 user 上但无外键（P6），必须在删 user 前清，
--    否则留下 user_id / follow_id 指向不存在用户的孤儿行
DELETE FROM xiaoku_db.user_follow
  WHERE user_id IN (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$')
     OR follow_id IN (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$');
DELETE FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$';
```

> **`user_follow` 无外键、不级联**：关注行 `user_id` / `follow_id` 都指向 user。
> 清 ct 账号时只认这两头的账号，别学 P5 那样「WHERE 一头」——
> 一个测试账号关注了另一个无效账号，删完就会留下孤儿行。
> P6 契约里专门有一步验证清理后 `follow_orphans = 0`。

> **必须用 `REGEXP` 而不是 `LIKE`**：MySQL 里 `LIKE 'ct_%'` 的 `_` 是**单字符通配符**，
> 会误删 `ct2_xxx` / `ct3_xxx` 之外的行。

> **正则里的 `[0-9]?` 不能省**：P5 引入了第三个契约账号 `ct3_<时间戳>`，
> 写成 `^ct2?_` 匹配不到它，每次跑都会漏一个常驻垃圾账号在库里躺着。

> **`DELETE` 一律要带 `WHERE`**：库里有 `xiaoku_demo`、`xk_ui_smoke`、`xk_ui_interact`、
> `xk_ui_follow` 这些常驻 fixture 也在 `xiaoku_db.note` / `comment` / `user_follow` 里。一条
> `DELETE FROM xiaoku_db.comment;` 会把它们一起清掉，而脚本跑完只显示「清理成功」，
> **没人会发现顺手删了别的东西**。
> 上面的写法把范围缩到测试笔记（子查询锚在 ct 账号正则上），正是这个原因。
> `xk_ui_*` 与 `xiaoku_demo` 是常驻 fixture，任何清理都不要碰。

> **清理不碰 ES**：契约测试发的笔记经 Kafka 进了 ES 索引，删库不会自动删索引文档。
> 搜索回填时按 MySQL 过滤，孤儿文档不会出现在结果里；要彻底清空就调
> `POST /api/search/reindex`（需登录）从当前库重建。

### 素材

`frontend/public/mascot/m01..m11.webp` 由 `frontend/scripts/mascot-cutout.py` 生成
（切比雪夫距离抠图 + 400px 裁剪 + WebP 压缩 92），脚本内置自检：
主体内部零误删、残留背景像素 ≤ 0.71%，不达标直接退出非零。

### P8 缓存/限流/幂等/计数：四个独立子系统

**1. 限流（`RateLimit` 注解 + AOP + Lua 原子计数）**
`register`/`login` 按 IP、`publish`/`image`/`comment`/`search`/`reindex` 按 USER，
Lua 里 `INCR + 首次 PEXPIRE` 是原子的，不会出现「只看不设过期」或「设了过期改散」。
Redis 异常一律 fail-open（服务不可用是能容忍的，把用户挡在门外不行）。
受保护的 + 公共的用户枚举信息用同一条消息，不给爆破提供噪音。

**2. 幂等（`Idempotent` 注解 + `X-Idempotency-Key` 请求头，对齐 Stripe）**
只认显式头：客户端不给就不生效（curl / 老版本不受影响）；给了就
`SET NX __PENDING__` 占位，业务失败必须 release 占位，否则「参数写错重试」
会永远拿到 100004；成功则回放缓存的 JSON。key = `xk:idem:{userId}:{uri}:{token}`，
换用户换 URL 换请求体都是新的幂等单元。**回放必须走原方法的返回类型序列化**，
这是 CGLIB 代理里最容易翻车的一环（接线错误是 P8 契约测出来的）。

**3. 布隆过滤器（`NoteIdBloomFilter`，纯 SETBIT/GETBIT）**
不引 redisson，用 FNV-1a64 + Kirsch-Mitzenmacher 双哈希铺 `2^24` 位，
启动 `ApplicationReadyEvent` 把库里笔记全量回灌，查询端先发制人挡掉
「ID 乱编但格式合法」的 20001 流量，再放行去打 DB。
关键容错（真实踩坑）：位图 key 被外部清掉（FLUSHDB / 驱逐 / 容器重启）时
`mightContain` 一律放行（缓存丢了 = 让所有真实请求去 DB，而不是全站 404）；
`add()` 发现 key 缺失时降级为「不过滤」并记错误日志，**绝不重建残缺位图**。

**4. 分布式锁（`LockTemplate`，对着 Redisson 手写薄封装）**
`tryLock(key, wait, lease)` 返回 `LockHandle`（`AutoCloseable`），被占返回 null，
Redis 异常 fail-open 返回空 handle（锁的目的是排序不是保命）。
`/api/search/reindex` 用它做互斥：已有任务在跑 → 50001「已有重建任务在跑」，
天然挡掉并发老板发起的全量重建，契约测试两账号 `Promise.all` 同打验证只有一个赢。

**5. Redis ZSet 计数权威 + 异步落库（推翻 P5 的「DB 列即权威」）**
- 权威：`xk:note:like:users:{noteId}` / `xk:note:collect:users:{noteId}` 两个 ZSet，
  member = userId。DB 关系行照旧 insert/delete（唯一索引当裁判）、兼作持久底账。
- 写：不再每赞打一次 `UPDATE note SET like_count = like_count + 1`——
  点赞/取消只动对应 ZSet（key 缺失时先按 DB 关系行**全量重建**再合入本次变更，
  否则裸 ZADD 会把老成员全顶掉）再 `SADD xk:note:dirty` 标记待落库。
- 读：详情与列表计数都从 `ZCARD` 拿（列表整页一条 pipeline：先 `EXISTS` 再对
  存活 key `ZCARD`，省一半往返）。**key 缺失时回退「DB 关系行的实时 COUNT」，
  不落 `note.like_count` 列**——那是异步产物的陈旧副本，回退到列会让详情页
  「刚点赞完的 +1」对不上（契约有专门断言钉这件事）。
- 落库：`NoteCounterFlushJob` 每 30s 抢 `xk:lock:note:counter-flush`，`SPOP`
  一批脏 noteId 用**绝对值覆盖**写回两列。绝对值写入天然幂等、崩溃安全、
  多实例各抢各批不打架——绝对值得它比增量/位图优先级高。
- Redis 全程 fail-open：Redis 不可用时关系还在 DB 里，读写都走行数，功能不降级只减速。
- 前端 `NoteDetailView` 的点赞/收藏切换变成「只合并自己那一维」：
  并发点两个键时，先响应的那份 VO 里另一维度是在它自己的事务快照里读的，
  MySQL RR 下可能落后于「另一个提交」瞬间，整包覆盖会把那一维打回旧值
  （CDP 实测随机回退成 `0|1` / `1|0`）。每个键自己的值永远是响应生成前刚提交的，
  所以合并只取自己那维、另一维保留本地现值，两键连点必然收敛。
- 这个坑有两种解法：后端让响应在事务提交后读，前端只合并自己那一维。
  两个都直指「响应来自事务内快照」这个根源；这里选了前端解法，
  因为网络乱序 + 多标签页并发是前端的常态，本地合并天然免疫。

---

### P9 部署 + 压测：全栈上真机

#### 1. 生产编排：`deploy/docker-compose.prod.yml`

开发期的 `docker-compose.yml` 只编排 Kafka / ES（MySQL、Redis 复用宿主服务），
P9 把它补成**全栈隔离**的生产编排：

```
                域名 / IP
                    │ :80
              ┌─────▼──────────────┐
              │  frontend (nginx)  │  SPA + /api 反代 + /static 图片反代
              └──────┬─────────────┘
                     │ :8088  (内网)
      ┌──────────────┼──────────────────┐
      │              │                  │
┌─────▼──────┐ ┌─────▼──────┐  ┌───────▼──────┐
│   backend  │ │   backend  │  │  Elasticsearch│
│ (Spring Boot) │ (多实例时...)│  │     :9200     │
└──┬──────┬──┘ └────────────┘  └──────────────┘
   │      │
┌──▼──┐ ┌▼─────┐        ┌──────────┐
│MySQL│ │Redis │        │  Kafka   │  KRaft，容器内仅 :29092
└─────┘ └──────┘        └──────────┘
```

- **只开一个口**：所有服务进 `xiaoku-prod-net` 内网，仅 frontend 暴露
  `${XK_WEB_PORT:-80}`；mysql / redis / kafka / es 不对宿主机开放。
- **kafka 改了监听**：容器内 `PLAINTEXT://kafka:29092`（开发 compose 对外 9092 是
  给宿主机看的，生产不适用），后端 `application-prod.yml` 的 bootstrap 地址随之切换。
- **build 带 `REGISTRY_PREFIX`**：`docker.io` 在大陆不可直连，本机走 daocloud 白名单
  镜像 `docker.m.daocloud.io/`（`maven` / `eclipse-temurin` / `node` / `nginx` /
  `mysql` / `apache/kafka` / `redis` 都在白名单；grafana/k6 不在，测试工具本机装）。
  ES 走 `docker.elastic.co` 直连，不加前缀。
- **变量闸**：模板 `deploy/.env.prod.example`；`MYSQL_ROOT_PASSWORD` / `XK_JWT_SECRET`
  必填用 `${VAR:?中文提示}`，缺了 compose 直接 exit=1。
- **健康链**：backend `depends_on` 四个中间件全部 `condition: service_healthy`，
  nginx 反代不到就绪的后端不会「假启动」。

```bash
# 生产栈（示例，.env.prod 由模板复制后填真值）
cd deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml ps   # all healthy

# 图片走 local 卷：uploads 数据卷，S3 改 XK_STORAGE_TYPE=s3 + 四个 S3 变量
```

#### 2. ER 图（schema.sql 8 张表）

```
 user ──╼ user_follow ──╼ user        E-R 关系
   │  (follow_id)   (user_id)           user 1—N note；note 1—N note_image
   │                                    note 1—N note_like / note_collect / comment
   ▼                                    note 1—N comment；comment 1—N comment_like
 note ──┬── note_image
         ├── note_like
         ├── note_collect
         ├── comment ── comment_like
```

| 表 | 主键 | 关键外键/约束 | 一句话职责 |
|---|---|---|---|
| `user` | `id` 雪花 | `username` 唯一、`gender` 枚举 | 账号 + 简介 + 计数列 |
| `note` | `id` 雪花 | `user_id`、`status`、`id_hash` 唯一 | 笔记正文 + 异步计数列 |
| `note_image` | `id` | `note_id` 索引、唯一索引 `(note_id, sort)` | 九图限制、顺序 |
| `note_like` | `id` | 唯一索引 `(note_id, user_id)` | 点赞持久底账 |
| `note_collect` | `id` | 唯一索引 `(note_id, user_id)` | 收藏持久底账 |
| `comment` | `id` 雪花 | `note_id` 索引、`comment_like` 子表 | 一级/二级评论（自引用） |
| `comment_like` | `id` | 唯一索引 `(comment_id, user_id)` | P5 只读不写，预留 |
| `user_follow` | `id` | 唯一索引 `(user_id, follow_id)`、status 弃用 | 关注/取关物理删，索引当裁判 |

所有业务表的主键都是雪花 ID，且**永不修改**（索引稳定性 + 分布式唯一）；
关系表用唯一索引承载幂等，不存在「唯一约束 + 软删除标记」的并发陷阱。

#### 3. 压测：k6 三场景混合负载

工具：**k6 v2.3.0**（goja 单线程、结果有确定性的分位数统计，比竞品更贴脚本）
目标：**生产栈**（`http://127.0.0.1:18080/api`，nginx → backend，真实反代链路）
数据：`deploy/loadtest/seed.mjs` 播种 —— 1 作者 + 12 篇笔记 + 10 读者
（关注作者、热评笔记 20 条评论），幂等可重跑（10003 视为已存在）。

| 场景 | VU | 时长 | 干什么 | 限流预算 |
|---|---|---|---|---|
| `browse` | 20 | 90s | 关注流 → 详情 → 评论列表；低频搜索、低频评论 | comment ≈4/分/用户 < 10 |
| `likers` | 6 | 60s | like/unlike、collect/uncollect 交替 | like/collect 不限流 |
| `authors` | 3 | 60s | 各发 1 篇笔记 | publish 3/分 < 20 |

其中 **10% 的详情请求故意打不存在的 17 位伪雪花 ID**，考察布隆过滤器短路的表现；
作者的笔记刚发布就搜「发布」能搜到，验证 Kafka → ES 异步同步的实时性。

```bash
node deploy/loadtest/seed.mjs                     # 打 18080；XK_API_BASE 可换
k6 run --summary-export=deploy/loadtest/report.json deploy/loadtest/mix.js
```

**结果（2026-09-29，本机单机 Docker，数值含宿主干扰，只作相对参考）**

| 指标 | 值 |
|---|---|
| 请求总量 | 12,122 次 @ **133.8 req/s** |
| 平均 / 中位 | **10.67 ms / 6.42 ms** |
| p90 / p95 / p99 | **16.0 / 20.6 / 45.0 ms** |
| 最大（单峰） | 910.8 ms |
| HTTP 失败率 | **0.00%**（12,122 全 2xx） |
| 业务断言（checks） | **7,832 / 7,832 = 100%** |
| 压测产生的笔记搜「发布」 | 14 条全部命中（种子外的都来自 load 期的 live 写入） |

阈值 `p(95)<600` / `p(99)<1500` / `rate<0.01` 全部通过。
结论：单机 Docker 上读写混合、接近 135 req/s 的负载下，链路是健康的；
p99 仍是个位数×10ms 量级，Bloom 短路和 Redis 计数让「读」面十分廉价。

压测里顺带抓到的**三个真实边界**，都是「业务规则」而非「故障」：

1. **nginx 拒收 URI 里的裸非 ASCII**：k6 直发 UTF-8 关键字 `花猫` 得 400，
   浏览器会自动百分号编码所以 CDP 从未踩到 —— `encodeURIComponent` 是压测脚本
   必须自己补的一课。
2. **作者不能评论自己的笔记（30007）**：authors 场景首版让作者评论自己的新笔记，
   3 个校验全红 —— 不是系统坏了，是模块故意禁止自我评论，脚本改成由读者产出评论。
3. **seed 与 k6 都要在限流桶内排队**：register 10/min、publish 20/min 的窗口
   是真实存在的，播种/压测脚本一旦被打回，先怀疑脚本节奏，别怀疑被测系统。

#### 4. 压测没覆盖 / 明说做不到的

- **单机压测不等于性能验收**：宿主 CPU/磁盘波动、Docker 网络栈、同一份 Redis/ES
  都在同机。要在云上给「QPS 天花板」「扩容曲线」这类结论，得另起环境跑。
- **没有加压到失败**：给出的是「此负载下健康」，不是「击穿点」。摸最大并发要
  阶梯加压逐档找 429 与 50x 的临界点，留给后续。
- **未做 CI 门槛**：k6 脚本留在 repo，可以与 git 钩子 / CI 联动做回归基准
  （阈值已在 options 里，直接当门槛）。

#### 5. 部署到新机器清单（面试话术版）

```bash
# 1) 主机准备：Docker + Compose；生成 32B+ 的 JWT 密钥
openssl rand -base64 64

# 2) 复制环境模板并填值（2 个必填：MYSQL_ROOT_PASSWORD / XK_JWT_SECRET；
#    中国大陆机器的 REGISTRY_PREFIX 保持 docker.m.daocloud.io/）
cp deploy/.env.prod.example deploy/.env.prod

# 3) 起栈（首次 build 拉镜像 + 编译前后端镜像）
deploy\docker compose --env-file .env.prod -f deploy\docker-compose.prod.yml up -d --build

# 4) 冒烟：页面 200、/api/system/ping OK、注册一个账号走通登录
curl http://host/api/system/ping

# 5) 关掉再开的迁移与回灌轨迹：
#    - 数据都在命名卷（mysql-data / es-data / kafka-data / redis-data / uploads）
#    - ES 索引可从 MySQL 全量回灌：登录后 POST /api/search/reindex
#    - 布隆过滤器启动时自动按当前库回灌，Redis 清库也能自愈
#    - 计数：ZSet 丢失自动按 DB 关系行重建；dirty 标记丢失只丢一次落库，无一致性问题
```

**面试可讲的几句话**：
「部署是 Docker Compose 全栈编排，只让 nginx 对外，四个中间件走内网；
生产配置把 dev 的 SQL 打印和 debug 日志关掉（`application-prod.yml`），
口令走 `${VAR:?}` 缺一即拒。压测用 k6 三场景混合压 135 req/s，
p99 25ms 内、零失败 —— 用来证明模块和编排在真机上是能跑起来的，
不是只过了单元测试。」
