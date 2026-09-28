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
| P5 | 点赞 / 收藏 / 评论（Redis 计数一致性推到 P8） | ✅ 已完成 |
| P6 | 关注关系 + 关注流 | ✅ 已完成 |
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

**防复发**：登录链路一旦改动，跑 `npm run test:ui`（110 条断言，见下）。第 1、2 条都有对应用例。

### 测试基建：`npm run test:ui`

用 Node 22 自带的 `WebSocket` 直接说 Chrome DevTools 协议驱动真实浏览器，
不引入 Playwright（为几条断言拉几十 MB 依赖不划算）。

| 脚本 | 覆盖 |
|---|---|
| `npm run test:ui:smoke` | 守卫拦截、吉祥物解码、CSS token、演示登录、双 token 落库、刷新保持登录、深浅模式与持久化、退出、注册、前端校验 |
| `npm run test:ui:refresh` | 坏 access 自动 refresh + 重放原请求、双 token 同步轮换、双 token 失效清理、无 refresh 安全降级 |
| `npm run test:ui:note` | 发布页守卫、空表单禁用、字数计数、本地预览、9 张上限、发布跳详情、详情图片**真实解码**（非碎图） |
| `npm run test:ui:profile` | 我的页守卫、资料回填、昵称超长前端拦截、保存后**回查后端**确认落库、取消不写库、演示账号自还原 |
| `npm run test:ui:interaction` | 点赞/收藏开关往返、两者互不影响、跨账号评论、回复嵌套与被回复者昵称、删根评论的确认弹窗与子树级联 |
| `npm run test:ui` | 五者全跑（110 条） |

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

- **DB 是计数的唯一权威，Redis 计数一致性推到 P8。** 计数用
  `UPDATE note SET like_count = like_count + 1` 原子自增，不做读-改-写；
  「先查有没有点赞再 insert」那种 check-then-act 会被并发打穿，
  这里只 insert、让 `uk_user_note` 唯一索引当唯一裁判。
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

### 后端契约测试：`node backend/scripts/contract-test.mjs`

P2 那 7 条断言原本是临时脚本，跑完就丢了，`git log` 里看不出「怎么测的」。
现在固化成落盘的契约快照，203 条（P2 44 + P3 32 + P5 58 + P6 69）：

```bash
cd backend
node scripts/contract-test.mjs          # 默认打 localhost:8088
XK_API_BASE=http://ip:8088 node scripts/contract-test.mjs   # 换地址
```

**为什么不用 JUnit / RestAssured / Testcontainers**：
这一层要验的是「HTTP 报文长什么样」——业务码、错误码、双 token 轮换、鉴权白名单、
VO 有没有漏出敏感字段。裸 HTTP 打一遍最直接，零依赖意味着任何人不装 Maven 插件、
不起容器也能跑。service 层的分支测试留给后续按需引入 Mockito。

覆盖的 6 组：

| 组 | 断言要点 |
|---|---|
| 鉴权 | 白名单（ping/register/login/refresh）免 token；其余默认全部 10005；坏 token 10006 |
| 参数校验 | 用户名长度/字符集、口令长度、昵称超长、性别越界 → 100001 且 message 具体 |
| 登录 | 口令错与用户不存在**返回同一个码和同一句提示**（防用户名枚举） |
| token | 双 token 签发、access 拒当 refresh 用、refresh 轮换、access 当 refresh 用被拒 |
| 契约形状 | `UserVO` 不含 `password` / `status` / `deleted`，未传 nickname 回落 username |
| P3 笔记域 | 图片类型白名单、空文件、**落盘文件名由服务端生成**、静态资源可回读、9 张边界两侧、10 张越界用专用码 20004、`javascript:`/`data:` URL 被拒、未登录三接口、查无此笔记 20001 |
| P5 互动域 | 点赞/收藏各自开关往返、重复与未互动用专用码 30001~30004、**两套关系互不影响**、下架/草稿笔记拒绝互动 |
| P5 评论域 | 不能评论自己的笔记 30007、回复拉平到同一根评论、**子回复截断到 3 条但 replyTotal 给真实总数**、级联删根评论且计数一次退完、非作者删除返回 30005 |
| P6 关注域 | 关注/取关各自开关注并重复操作 40001/40002、自关注 40003、目标不存在 10001、**关注/粉丝列表的 followed 是「当前浏览者是否也关注」**、互关后两列表都有 true、作者主页笔记列表 20001 区分「无笔记」与「用户不存在」、作者卡片一次往返拿全、feed 只含关注中作者的笔记、**取关后计数回滚且从 feed 消失** |
| P6 feed | JOIN 不 IN、列表含作者信息、空 feed、分页回显、未登录 10005 |

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
-- 1) 先子表后父表。P5 之后有四张表挂在 note 下面，
--    comment_like 又挂在 comment 下面，少删一张就留孤儿行
DELETE FROM xiaoku_db.comment_like
  WHERE comment_id IN (SELECT id FROM xiaoku_db.comment WHERE note_id IN (SELECT id FROM xiaoku_db.note));
DELETE FROM xiaoku_db.comment WHERE note_id IN (SELECT id FROM xiaoku_db.note);
DELETE FROM xiaoku_db.note_like   WHERE note_id IN (SELECT id FROM xiaoku_db.note);
DELETE FROM xiaoku_db.note_collect WHERE note_id IN (SELECT id FROM xiaoku_db.note);
DELETE FROM xiaoku_db.note_image  WHERE note_id IN (SELECT id FROM xiaoku_db.note);
DELETE FROM xiaoku_db.note;
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
> 上面的写法先 `SELECT id FROM note` 把范围缩到测试笔记，正是这个原因。
> `xk_ui_*` 与 `xiaoku_demo` 是常驻 fixture，任何清理都不要碰。

### 素材

`frontend/public/mascot/m01..m11.webp` 由 `frontend/scripts/mascot-cutout.py` 生成
（切比雪夫距离抠图 + 400px 裁剪 + WebP 压缩 92），脚本内置自检：
主体内部零误删、残留背景像素 ≤ 0.71%，不达标直接退出非零。
