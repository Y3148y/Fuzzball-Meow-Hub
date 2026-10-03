# AGENTS.md —— 本项目的操作前提与硬性规则

给后续接手的人（和 AI 助手）看。这里只写**不看就会踩坑**的东西；
设计意图和阶段规划在 `README.md`。

---

## 1. 命名约定（不要随便改）

| 层 | 名称 | 说明 |
|---|---|---|
| 产品 / 社区名 | **毛球喵社 Fuzzball-Meow-Hub** | 与 GitHub 仓库名逐词对应 |
| 吉祥物名 | **小哭猫 Xiaoku** | 角色本身，类比 GitHub 之于 Octocat |

`xiaoku` 同时是**吉祥物代号**，不是平台名。因此以下标识符**刻意保持原样，不要改**：

- Java 包 `com.xiaoku`（38 个源文件）
- `xiaoku_db`、`xiaoku-mysql` / `xiaoku-kafka` / `xiaoku-elasticsearch`、`xiaoku-net`
- 配置前缀 `xiaoku:`、JWT `issuer=xiaoku`
- `xiaoku-backend`（artifact / `spring.application.name` / 日志文件名）
- 类名 `XiaokuApplication`
- 演示账号 `xiaoku_demo`，其昵称是「小哭猫」

改这些的收益只是"拼写看起来更统一"，代价是数据迁移 + 容器重建 + 全量回归。
**只有用户可见文案**（README、`index.html`、页面品牌、router 标题、`document.title`、
OpenAPI 标题、启动横幅、`pom.xml` description、配置注释头）才跟产品名走。

因为演示账号昵称保持「小哭猫」，前端 CDP 测试里的 5 处昵称断言
**不需要**跟着改名。

---

## 2. 环境前提（这台机器上）

```powershell
# JAVA_HOME 默认指向 JDK 8，直接跑 Maven 会报「无效的目标发行版: 17」。
# 任何 mvnw / mvn 命令前必须先覆盖：
$env:JAVA_HOME = "E:\JDK17\jdk-17.0.1"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
```

```powershell
# GitHub 推拉：**先试直连，不通再带代理**。git 不会自动用系统代理
# （PowerShell 的 Invoke-WebRequest 会）。
# 2026-10-01 实测：代理 127.0.0.1:7897 端口在监听，但经它的 schannel TLS
# 握手直接失败（SSL/TLS connection failed），不带代理反而推成功了 ——
# 旧记录「直连必失败、push 要带代理」已过时。判断顺序：
git ls-remote --heads origin           # 通 → 直接 git push origin main
# 不通才带代理：
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
```

其他固定前提：

- MySQL 容器绑定 **`127.0.0.1:3309`**（只对回环开放，刻意不对局域网暴露）
- Elasticsearch `9250`、Kafka `9092`、后端 `8088`、前端 dev `5180`
- 仓库根目录 `.env` 提供 `MYSQL_ROOT_PASSWORD`（**永不提交**）

**连 MySQL 只能这么写（2026-09-29 实测，其他写法全部失败）**：

```powershell
$pwd = (Select-String -Path .env -Pattern "^MYSQL_ROOT_PASSWORD=(.*)$").Matches.Groups[1].Value
$env:MYSQL_PWD = $pwd   # 别用 -p：交互式会索要口令，非交互式又会把口令打到日志里
& "E:\Web\MySQL\bin\mysql.exe" --no-defaults --host=127.0.0.1 --port=3309 --user=root "--execute=SELECT 1"
```

两个坑：

1. **必须 `--no-defaults`**：这台机的 option 文件（`C:\WINDOWS\my.ini` 等）与
   MySQL 9.0.1 客户端不兼容，**不加这个开关时 mysql 只会打一屏 usage 然后退出**，
   看起来像「SQL 写错了」，其实是根本没执行。
2. **必须用长参数 `--host=127.0.0.1`，不能用粘连的短参数 `-h127.0.0.1`**：
   粘连写法会被解析成 host=`127`，报 `Unknown MySQL server host '127'`。

用 `mysql --version` 确认客户端本身是好的（`Ver 9.0.1 for Win64`）；如果连
`--version` 都打不出来，才是二进制本身坏了。

---

## 3. 启动后端：口令变量是强制的

```powershell
cd backend
$env:JAVA_HOME = "E:\JDK17\jdk-17.0.1"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:XK_MYSQL_PASSWORD = "<.env 里的 MYSQL_ROOT_PASSWORD>"   # 不设就起不来
.\mvnw.cmd -o -q spring-boot:run
```

**少设这个变量时的真实报错**（2026-09-27 实测，三种情况逐个试过）：

| `XK_MYSQL_PASSWORD` | 结果 |
|---|---|
| 未设置 | 启动失败：`Access denied for user 'root'@'172.20.0.1'` |
| 空串 | 同上 |
| 正确值 | 正常启动 |

⚠️ **不会**出现 `Could not resolve placeholder 'XK_MYSQL_PASSWORD'` ——
未解析的占位符在属性绑定阶段被当作空值放过了。所以看到 `Access denied`
时别只怀疑口令写错，**先 `echo $env:XK_MYSQL_PASSWORD` 确认变量在不在**。

`docker compose` 侧有独立的一道闸：`.env` 缺失时
`${MYSQL_ROOT_PASSWORD:?...}` 会让 compose 直接 exit=1 并打印中文提示。
已实测有效。

---

## 4. 敏感信息：清洗历史后必须清掉副本

这条是**硬性规则**，2026-09-27 踩过一次：

1. 仓库历史被重写过（旧口令已从所有 commit 与 tag 中移除并 force-push）。
   但重写**之前**在临时目录留下过两份副本：
   `C:\Users\y\AppData\Local\Temp\opencode\red-book-backup`（Git 镜像）
   和 `env.bak`。里面仍是**清洗前**的旧密码 —— 历史洗了，副本没洗，等于没洗。
2. 这两份已删除，临时目录与工作区对旧口令零命中。

**规则**：

- 任何一次改写 Git 历史 / 移除敏感值之后，**先确认远端已同步**，再删所有
  清洗前产生的镜像、`.bak`、临时导出。删之前先核对副本里的 tag 哈希是否还是
  旧值（是旧值才说明它是清洗前的副本）。
- `.env` 永远不提交，`.gitignore` 已覆盖 `.env` / `.env.local`。
- 代码与配置里**不留任何口令兜底值**（`${XK_MYSQL_PASSWORD:}` 这种空串兜底也不行：
  它会在"恰好配了无口令 MySQL"的机器上静默连上）。
- 想改口令就直接改，别为了"方便"把默认口令写回仓库。

---

## 5. 测试入口

改后端接口 → 必须跑契约测试；改前端 → 必须跑 CDP 测试。**别攒到最后一起跑。**

```bash
# 后端（需后端已在 8088 运行）→ 355 条
cd backend && node scripts/contract-test.mjs
# 换地址：XK_API_BASE=http://ip:8088 node scripts/contract-test.mjs

# 前端（需前端 5180 + 后端 8088 同时在跑）
# → 24 + 8 + 82 + 26 + 52 + 25 + 19 + 9 + 108 = 353 条
cd frontend && npm run test:ui

# 单跑某一组：:smoke / :refresh / :note / :profile / :interaction / :follow / :search / :idempotent / :layout
cd frontend && npm run test:ui:interaction

# 前端类型 / 构建
cd frontend && npm run typecheck && npm run build
```

契约测试每次跑会新建 `ct_/ct2_/ct3_/ct4_/ct5_<时间戳>` 等账号
（必须随机，固定账号会撞 `10003` 就测不到注册成功分支），**并留下它们的笔记和图片**。
`ct5_` 是 P7 搜索轮询的专用账号——搜索接口 60/min 限流，轮询用自己的额度
才不把断言账号的桶打空（50 次 × 500ms ≈ 25s 预算）。

清理有**两个**坑，第二个比第一个危险得多：

```sql
-- 0) 先把 ct 账号 id 落临时表：后面每条 DELETE 都锚在它上面，
--    既不用抄三遍正则，也保证「只删测试账号的东西」这件事肉眼可验证
CREATE TEMPORARY TABLE _ct AS
  SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$';
SELECT COUNT(*) FROM _ct;   -- 先看清要删几个，再往下删

-- 1) 顺序：先子表后父表。P5 之后有四张表挂在 note 下面，
--    comment_like 又挂在 comment 下面，少删一张就留孤儿行
DELETE FROM xiaoku_db.comment_like
  WHERE comment_id IN (SELECT id FROM xiaoku_db.comment
    WHERE note_id IN (SELECT id FROM xiaoku_db.note WHERE user_id IN (SELECT id FROM _ct)));
DELETE FROM xiaoku_db.comment
  WHERE note_id IN (SELECT id FROM xiaoku_db.note WHERE user_id IN (SELECT id FROM _ct));
DELETE FROM xiaoku_db.note_like
  WHERE note_id IN (SELECT id FROM xiaoku_db.note WHERE user_id IN (SELECT id FROM _ct));
DELETE FROM xiaoku_db.note_collect
  WHERE note_id IN (SELECT id FROM xiaoku_db.note WHERE user_id IN (SELECT id FROM _ct));
DELETE FROM xiaoku_db.note_image
  WHERE note_id IN (SELECT id FROM xiaoku_db.note WHERE user_id IN (SELECT id FROM _ct));
DELETE FROM xiaoku_db.note WHERE user_id IN (SELECT id FROM _ct);
-- 2) user_follow 无外键不级联（P6），必须在删 user 前先把 ct 账号两头的关系清掉，
--    否则留下 user_id / follow_id 指向不存在用户的孤儿行
DELETE FROM xiaoku_db.user_follow
  WHERE user_id IN (SELECT id FROM _ct) OR follow_id IN (SELECT id FROM _ct);
DELETE FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$';
```

1. **`REGEXP` 而不是 `LIKE`**：MySQL 里 `LIKE 'ct_%'` 的 `_` 是单字符通配符，会误删。
   正则里的 `[0-9]?` 也不能省 —— 写成 `^ct2?_` 匹配不到 `ct3_`，每跑一次漏一个常驻垃圾账号。
2. **每条 `DELETE` 都必须带 `WHERE`**：库里还有 `xiaoku_demo`、`xk_ui_smoke`、
   `xk_ui_interact`、`xk_ui_follow` 这些常驻 fixture 的笔记、评论和关注行。
   `DELETE FROM xiaoku_db.comment;` / `DELETE FROM xiaoku_db.user_follow;`
   这种全表清空会把它们一起删掉，而脚本跑完只显示「清理成功」，
   **没有任何迹象表明你顺手删了别的东西**。
   ⚠️ 旧版这份文档里的清理 SQL 就是**每条都锚在 `xiaoku_db.note` 上**的
   （最后一条 `DELETE FROM xiaoku_db.note;` 甚至没有 `WHERE`），
   与它自己下一条禁令直接矛盾。**照抄会连 fixture 的笔记一起删掉。**
3. **ES 里会留下孤儿文档**：P7 起测试笔记会经 Kafka 进索引，删库不删索引。
   搜索回填时按 MySQL 过滤，结果不受影响；想彻底清空就调
   `POST /api/search/reindex`（需登录）从当前库重建。
4. **临时表在同一条语句里只能引用一次**：`DELETE FROM xiaoku_db.user_follow
   WHERE user_id IN (SELECT id FROM _ct) OR follow_id IN (SELECT id FROM _ct)`
   会报 `ERROR 1137 Can't reopen table: '_ct'`，而且**报错之前那几条 DELETE 已经
   执行完了**（半截清理），别以为整段没生效。要么拆成两条语句，要么把子查询
   包一层派生表 `SELECT id FROM (SELECT id FROM ... ) k`（派生表会物化，不受此限）。
   这条 2026-10-01 实测踩过。

删库不会删文件，图片还在 `backend/uploads/`（已 gitignore），要清就整个删掉。

前端 CDP 测试的常驻 fixture：`xk_ui_smoke`（登录冒烟）、`xk_ui_interact`
（互动搭子+常驻评论）、`xk_ui_follow`（关注流素材号，口令同为 `Xk@2026peer`）。
撞 `10003` 都判为通过，**三个都不要清理**。测试需要 Chrome，路径可用 `XK_CHROME` 覆盖。

库里另有一套 **P12-C 演示种子数据**：`backend/scripts/seed-demo.mjs` 造的 6 个
`xk_seed_*` 账号（口令统一 `Xk@123456`）+ 22 篇真封面笔记，外加 `xiaoku_demo`
自己的 4 篇。脚本**可重复跑**（按标题跳过已存在的），删库不删脚本，重跑即回种。
要清就按上面的模式把它和 `idem*`（`ui-idempotent` 每次跑新建的账号）一起删 ——
`REGEXP` 写成 `'^ct[0-9]?_[a-z0-9]+$' OR '^idem[0-9]+$' OR '^xk_seed_'`，
再把 demo 的笔记单独一并删（账号留着）。两条硬约束：

- **demo 的粉丝数必须保持 0**：`ui-follow` 有断言「没人关注演示账号 → 粉丝空态」。
  所以种子里只有 demo→种子的关注，**没有反向的**，别"顺手"加对称关注。
- **种子标题/正文避开「笔记 / 测试 / 关注」**：`ui-search` 断言
  「搜 `P6 关注流测试笔记` 第一张卡就是它」，ik_smart 切词 + multiMatch 是 OR，
  种子内容吃了这些词就会抢相关度排到前面去。

### 读测试结果时的一个坑

契约测试输出是 UTF-8 中文。在 PowerShell 里用
`node x.mjs | Select-String "通过"` 匹配，**中文会因控制台编码对不上而匹配失败**，
很容易误判成「测试挂了」。稳妥做法是落盘再读：

```powershell
node scripts/contract-test.mjs > "$env:TEMP\ct.txt" 2>&1
Get-Content "$env:TEMP\ct.txt" -Encoding UTF8 | Select-String "====="
# 或直接看 $LASTEXITCODE
```

---

## 6. 雪花 ID：Long 必须序列化成字符串

这条是 P3 用契约测试抓出来的**真实缺陷**，不是风格偏好：

```
后端 ID  = 362756654342606850          （10^17 量级）
JS 解析后 = 362756654342606848          JSON.parse 静默四舍五入
```

JS 的 `Number.MAX_SAFE_INTEGER` 只有 `9007199254740991`（约 9.007×10^15）。
超出后**不抛错、不告警**，只是数悄悄变了。后果是回传 ID 查详情直接
`20001 笔记不存在` —— 表现成「数据明明发过却查不到」，极难定位。

因此：

- `JacksonConfig` 只对 **Spring MVC 的 ObjectMapper** 注册 `ToStringSerializer`
- **不要**改 `RedisObjectMapperProvider`：那是另一个 ObjectMapper 且带
  `activateDefaultTyping`，缓存里落成字符串后反序列化回 `UserVO` 会类型不匹配
- 非 ID 的数值别用 `Long`：`LoginVO.expiresIn` 已改成 `Integer`，
  `PageVO.total/page/size` 也已改成 `Integer`（P5 踩过同一个坑：它被序列化成
  `"1"`，前端 `total === 1` 恒为 false）
- 前端 `types.ts` 用 `SnowflakeId = string`，赋值时不要 `Number()` / `parseInt`
- 契约测试里有两条断言专门钉这件事（类型必须是 string、BigInt 必须 > MAX_SAFE_INTEGER）

## 6.1 `non_null`：`null` 字段在 JSON 里是「不存在」

`application.yml` 配了 `default-property-inclusion: non_null`，
所以**值为 null 的字段会整个从 JSON 里消失**，前端拿到的是 `undefined` 不是 `null`。

```
VO { id: "123", avatar: null }   →   { "id": "123" }
```

因此判断「有没有值」必须用 `== null` 或真值判断，
写 `=== null` 会永远走进「有值」那个分支，用 `'avatar' in obj` 同理。
前端 `types.ts` 里的 `Nullable<T>` 就是这个约定。

## 6.2 前端 `request.ts` 的 `get(url, params, config)`

**第二个形参直接就是 query 参数本身，不是 axios config。**

```ts
get('/comment/list', { noteId, page, size })          // ✅
get('/comment/list', { params: { noteId, page } })    // ❌ 发出 ?params[noteId]=...
```

后者语法合法、`vue-tsc` 也不报错，但 axios 会把整个对象当**一个**参数序列化，
后端收到「缺少必要参数：noteId」。**契约测试抓不到**，因为它走裸 HTTP
绕开了整个前端封装层，只有真机点一下才会暴露。

## 7. 已完成状态（2026-09-30）

- P0 环境编排 / P1 统一响应与异常 / P2 用户模块 + JWT / P4 部分（登录 + 首页）已合并推送
- 品牌改名已落地（`62ed4c5`），测试通过且未改任何测试断言
- 契约测试已落盘（`f8f412c`），现为 **222 条断言**（P2 44 + P3 32 + P5 58 + P6 69 + P7 19）
- 口令兜底修正 + 注释订正（`cf93b22`）
- AGENTS.md 本身已提交（`3978ed0`）
- P3 后端已推送（`fd4140e`），含雪花 ID 精度修复
- P4 前端已完工（登录 / 首页 / 发布 / 详情 / 我的五页 + 69 条断言）
- P5 互动域已完工并推送：点赞 / 收藏 / 评论 + 契约 134 条 + CDP 110 条
  - `module/note/` 发布 / 详情已实现；`common/storage/` 抽出 `ImageStorage`
    抽象，`type=local` 落本地盘、`type=s3` 走 S3 协议
  - 上传文件名**一律服务端生成 UUID**，扩展名按 content type 白名单反推，
    绝不使用用户提供的原始文件名（防路径穿越与扩展名伪装）
  - 笔记域错误码已在 `ErrorCodeEnum.java:39` 预留并在用：
    `NOTE_NOT_FOUND` / `NOTE_STATUS_ILLEGAL` / `NOTE_UPLOAD_FAILED` /
    `NOTE_IMAGE_LIMIT_EXCEED`（9 张上限）
- P6 关注域已完工：关注 / 取关 / 关注列表 / 粉丝列表 / 作者主页
  / 关注流 + 契约 203 条 + CDP 135 条
  - `module/follow/`（`UserFollowEntity` / `FollowUserVO` / 两个 service /
    `FollowController`）+ `module/feed/`（JOIN SQL）+ 笔记域只读改动
  - `user_follow.status` 列**闲置弃用**：关注/取关走物理删，唯一索引当裁判
  - `NoteVO` 新增 `authorId` + `authorFollowed`（P4「不暴露作者 ID」的决定被反转，
    三处注释一对）；列表卡片用新的 `NoteListItemVO`
  - `GET /api/follow/user/{id}` 作者卡片一次往返拿全（UserVO 字段 + followed）
  - feed 用 `INNER JOIN user_follow` 而不是先查 IDs 再 `IN`
  - 前端新页：`FollowListView.vue`（`/follow/:id` 与 `/fans/:id` 双路由共用）、
    `UserView.vue`；首页 env 自检卡移除换成关注流；详情页作者区加关注按钮
  - `schema.sql` 在 P0 就已建好全部 8 张表，含 `note` / `note_image`，
    **P3 没有改 schema**
- P7 搜索域已完工（本 commit）：ES 检索 + Kafka 异步同步
  + 契约 **222 条** + CDP **154 条**
  - `module/search/`：`NoteEventDTO` / `NoteSearchDoc` / `NoteSearchRepository` /
    `NoteSearchConsumer` / `SearchService(Impl)` / `SearchController`
  - 接口：`GET /api/search/note?keyword=&page=&size=`、
    `POST /api/search/reindex`（删旧索引 + 从 MySQL 全量回灌，需登录）
  - **`KafkaConfig.xkProducerFactory` 有真实缺陷**：P0 手写的 config map 漏了
    `bootstrap.servers`，启动不报错、**首次真发消息**才抛
    `No resolvable bootstrap urls`。已改为 `kafkaProperties.buildProducerProperties(null)`
    打底再覆盖自有键。另有 `kafkaErrorHandler` bean（DLT + `FixedBackOff(1s,3)`）
- P8 四件套已完工（本 commit）：限流 / 幂等 / 布隆 / 分布式锁 + Redis 计数权威
  + 契约 **276 条**（P2 44 + P3 32 + P5 58 + P6 69 + P7 19 + P8 54）+ CDP **163 条**
  - 限流 `common/annotation/RateLimit` + AOP + Lua（`INCR`+首次 `PEXPIRE` 原子）：
    register/login 按 IP，publish/image/comment/search/reindex 按 USER，
    Redis 异常 fail-open；契约 16.1 节
  - 幂等 `common/annotation/Idempotent` + AOP + Store：请求头 `X-Idempotency-Key`
    对齐 Stripe（不给头不生效）；回放返回**原方法返回类型**序列化的缓存 JSON
    （CGLIB 代理的坑，P8 契约抓过）；前端 `request.ts` 的 `_xkIdemKey` +
    note/comment 接口 `idempotent:true`；契约 16.2 节 + CDP `ui-idempotent.mjs`
    （9 条，Fetch 域拦截篡改 Authorization 精确模拟 401）
  - 布隆 `common/support/NoteIdBloomFilter`：FNV-1a64 + Kirsch-Mitzenmacher，
    纯 SETBIT/GETBIT，启动 `BloomWarmUpRunner` 全量回灌，向左查详情短路 20001。
    **容错三件事（都踩过）**：(1) 位图 key 被外部清掉时 `mightContain` 放行
    （否则全站真实笔记 404）；(2) `add()` 遇 key 缺失降级为不过滤，绝不重建
    残缺位图；(3) 位下标依赖 bitCount，改 config 必须 `#reset()` 重灌
  - 分布式锁 `common/support/LockTemplate`（Redisson 薄封装，fail-open）：
    挂在 `SearchServiceImpl.rebuildNoteIndex` 上，reindex 并发互斥返回 50001；
    契约 16.0 节（`Promise.all` 并发同打）
  - **Redis 计数权威 + 异步落库**（推翻 P5「DB 列即权威」）：
    - ZSet `xk:note:like|collect:users:{noteId}` 是当前权威，member=userId；
      DB 关系行照旧 insert/delete（唯一索引当裁判）兼作持久底账
    - 写只动 ZSet + `SADD xk:note:dirty`，不再每赞 UPDATE 一次列。
      key 缺失时先按 DB 关系行**全量重建**再合入本次变更（防裸 ZADD 顶掉老成员）
    - 读走 `ZCARD`（列表页整页 pipeline 先 EXISTS 再 ZCARD）；**key 缺失回退
      「DB 关系行实时 COUNT」而不是 `note.like_count` 列**——列是异步产物，
      回退列会让详情页对不上刚点的 +1（P8 契约有断言钉）
    - `NoteCounterFlushJob` 每 30s 抢 `xk:lock:note:counter-flush`，SPOP 一批
      脏 noteId 用**绝对值覆盖**写回两列（幂等 / 崩溃安全 / 多实例不打架）。
      ZSet key 空了会自动删除；dirty/位图 key 丢失都会**自动降级重建**，
      无需手动清理
    - 前端 `NoteDetailView` 切换点赞/收藏改**只合并自己那一维**：并发双键时
      后响应 VO 的另一维是它自己事务快照里的旧值，整包覆盖会随机回退
      成 `0|1`/`1|0`（CDP 实测，批量 5 修复）
  - P8 计数详情见 `NoteCounterStore` / `NoteCounterFlushJob` 的类注释 + README「P8」段
  - `NoteServiceImpl.publish` 在 **afterCommit** 发事件（key=noteId，失败只记日志）
  - 消费端 `application.yml` 显式配 `JsonDeserializer` + `default.type`，
    因为生产端复用的是 Spring MVC 那个 `ObjectMapper`（Long → 字符串）
  - **ES 只存检索字段**，命中后回 MySQL 组卡（昵称/计数/authorFollowed 都是当前值），
    并按 id 映射重排以保住 ES 的相关度/时间序
  - 点赞/收藏/评论计数变化**不触发**重建索引（计数在回 MySQL 时现查），漂移推给 P8
  - 前端新页 `SearchView.vue`（`/search?keyword=`，query 传关键词）+ 首页搜索框；
    CDP 新组 `ui-search.mjs`（19 条）复用 `xk_ui_follow` 的常驻素材笔记
  - 搜索域错误码 50xxx：`SEARCH_SERVICE_ERROR` / `SEARCH_KEYWORD_EMPTY`
- P9 部署 + 压测（本 commit）：**12122 请求 @ 133.8 req/s，p95 20.6ms / p99 45ms，
  失败率 0%，checks 7832/7832**
  - `deploy/docker-compose.prod.yml`：全栈内网（name=xiaoku-prod 网络），仅
    frontend 暴露 `${XK_WEB_PORT:-80}`；backend 四中间件 depends_on healthy；
    kafka 容器内改 `PLAINTEXT://kafka:29092`（开发 9092 是给宿主看的，生产不适用）
  - `backend/application-prod.yml`（prod profile）：SQL 打印与外发日志关掉、
    `xiaoku.jwt.secret=${XK_JWT_SECRET}` 无兜底、`init-demo-data` 默认 false
  - `backend/Dockerfile`/`frontend/Dockerfile` + nginx.conf：多阶段构建，非 root，
    `AGENT REGISTRY_PREFIX`/`ARG REGISTRY_PREFIX` 支持镜像加速前缀（本机填
    `docker.m.daocloud.io/`，ES 走 docker.elastic.co 不加）——**grafana/k6 不在
    daocloud 白名单**，压测工具本机装
  - `deploy/.env.prod.example`：`MYSQL_ROOT_PASSWORD` / `XK_JWT_SECRET` 用
    `${VAR:?}` 闸，缺一 compose exit=1；实际 `.env.prod` 已 gitignore
  - 压测：`deploy/loadtest/seed.mjs`（Node 零依赖，幂等）造 1 作者 + 12 笔记 +
    10 读者（关注 + 热评笔记 20 条评论）；`deploy/loadtest/mix.js`（k6）三场景
    browse 20VU/likers 6VU/authors 3VU，10% 详情打伪 ID 体现布隆短路，k6 输出
    `deploy/loadtest/report.json`
  - **压测抓的三个边界**（都是规则不是故障）：nginx 拒收 URI 裸非 ASCII → k6 要
    `encodeURIComponent`（浏览器自动编码，CDP 永远踩不到但 k6 一定踩）；
    作者不能评论自己的笔记（30007）→ authors 场景不写评论，评论写入交给 browse；
    seed/压测必须在自己限流余量内跑（register 10/min、publish 20/min），被打回先
    怀疑脚本节奏
  - 注意：loadtest 会在库里留下 `xk_lt_*` 账号与笔记（`ct` 清理 SQL 的 REGEXP
    不会碰到它们，正常跑不受影响）；压测目标走 prod 栈 nginx 18080 而非 dev 8088，
    因为 dev profile 是 debug+SQL 打印，会拉偏数据
- P10 五件套已完工（本 commit）：笔记编辑/上下架 + 评论点赞 + IK 分词
  + 补 P0–P9 标签 + 清理压测残留，契约 **332 条**（+P10 56 条）+ CDP **174 条**
  （+11 条评论点赞断言：interaction 41→52）
  - **笔记编辑 / 上下架**：`PUT /api/note/{id}`（body=NotePublishDTO 全量更新）+
    `PUT /api/note/{id}/status`（body `{status:1|2}`，0 走 100001）。详情门禁：
    作者可见自己 status 0/2；非作者 0→20001、2→20002。`pageUserNotes`：本人=管理
    视图全状态，他人=仅 status=1。图片=删旧重插；更新用 LambdaUpdateWrapper 显式
    set（含 null，避开 not_null 策略吞掉清空的 cover/videoUrl）；事件在 afterCommit
    发：编辑已发布→PUBLISH、已下架→UNPUBLISH、下架→UNPUBLISH、上架→PUBLISH
    （createTime 保持首发值）。两端点 @RateLimit(20/min, USER)，PUT 幂等不加头。
    契约 17.2 段覆盖「下架→搜索消失、上架→恢复可搜」的 Kafka 链路。
  - **评论点赞**：`PUT/DELETE /api/comment/{id}/like`，与笔记共用 30001/30002。
    like：评存在（30005）+ 父笔记 status=1（20002）；唯一索引防重→30001；
    仅插入成功才 `like_count+1`。unlike：评论存在（30005）；删 0 行→30002；
    `GREATEST(0, like_count-1)`；**刻意不做笔记状态门禁**，规避笔记侧
    「下架后取消失败连带回滚」的坑（P5 缺口之一）。前端详情页根评论 + 回复都可赞，
    只合并 liked/likeCount 单维（对齐 P8 并发语义），30001/30002 静默整页重拉。
  - **IK 中文分词**：`deploy/es/Dockerfile` 自建 ES 镜像装 analysis-ik 8.17.6
    （zip 在 `deploy/es/ik/` 且 gitignore 不入库），dev/prod compose 的
    elasticsearch 均改 `build:`。`NoteSearchDoc` 索引用 `ik_max_word`、
    查询用 `ik_smart`（标准用法）。换 analyzer 后必须重建索引
    （`POST /api/search/reindex`），旧 mapping 不会自动升级——本次就是这么抓的：
    先 reindex 后 mapping 仍是 standard，因为跑的是改动前旧类，重启后端再 reindex 才对。
  - 清理：删了 dev `ct_%` 测试账号 + prod `xk_lt_*`/`prod_smoke1` 压测残留
    （prod 27 笔记 + 80 评论 + 10 关注），prod/dev ES 都 reindex 清掉已删笔记的
    孤儿文档（prod 用临时账号 `prod_clean` 注册→reindex→删号）
  - git 标签：v0.3–v0.9 已补（对应 P3–P9 收官 commit），与既有 v0.1/v0.2 同风格
  - **prod ES 仍是旧 standard 镜像**：只改了 prod compose 的 `build:`，没重建
    prod ES 容器；下次部署重新 `docker compose -f deploy/docker-compose.prod.yml
    --env-file .env.prod up -d --build` 时自然带上 IK。dev 已生效并回归（契约 332
    + 搜索 CDP 19 条全绿）
- P11 小红书对齐已完工（本 commit）：作者自评放开 + 图文必带图 + 删除笔记
  + 契约 **355 条**（+P11 23 条）+ CDP **184 条**（174 → 184，ui-note 17→27）
  - **A 作者可评论自己笔记**：`CANNOT_COMMENT_SELF_NOTE`(30007) 枚举保留不删，
    只移除 `CommentServiceImpl` 的检查（自评/自回复合法）。契约 14 节断言翻转
    （作者自评成功 + 自删 + commentCount 归 0），16.2 幂等「业务失败」触发源改
    成「给不存在的笔记评论 20001」（原来自评触发 30007 的路径已合法）。
  - **B 图文发布必须至少一张图**：`validatePublishParams(dto, requireGraphicImage)`
    —— publish 传 `true`，update 传 `false`（保留 P10「编辑可清空图片」语义）。
    空/缺/空组 `imageUrls` 一律 10001。契约 11 节新增断言。
  - **C 删除笔记**：`DELETE /api/note/{id}` 作者本人，非作者/不存在一律 20001
    （防探测）。事务内级联 `comment_like → comment → note_like → note_collect →
    note_image → note`；afterCommit 发 `ACTION_DELETE` 事件由
    `NoteSearchConsumer` `deleteById`；`NoteCounterStore.removeCounters` 清 Redis
    ZSet/dirty 键（fail-open）。用户头像/笔记图片文件本体仍留在
    `backend/uploads/`（gitignore），要清就整个目录删。
  - **契约测试 17.4「删除」段 & 三个踩过的坑**：①搜索断言词必须用独立随机锚点
    `delUnique='delok'+random`，**不能复用共享 stamp**——ik_smart 拆词 + multiMatch
    OR 会撞车同 stamp 的其它笔记（实测 total=20 永不归零）；②轮询/评论改用
    `rlAuth`（`pollAuth` 的 60/min 被 P7+17.2 轮询打空，`actorAuth` 的评论
    10/min 被打满）；③`/api/comment/list` 对已删笔记返回 **20001** 而非空列表
    （断言按 20001 写）。17.4 全链：发一条带图笔记→互动→评论→删除→详情 20001
    →重复删 20001→作者主页消失→评论列表 20001→ES 轮询消失。
  - **前端**：`api/note.ts` 新增 `updateNote` / `changeNoteStatus` / `deleteNote`；
    新建 `NoteEditView.vue`（`/edit/:id(\d+)`，编辑+新图即传+全量覆盖，可移除图片，
    可直接手输 URL 但非作者会被后端 20001 拦）；`NoteDetailView.vue` 作者操作区
    `[data-test=note-author-ops]`（编辑/下架·上架/删除，删除有 Vant 二次确认）。
    `types.ts` 的 `NoteVO` 补上 P10 就有的 `status` 字段（**P10 漏补，typecheck 抓**）。
  - **P11 起 CDP 所有发布流程都要先传图**：ui-interaction / ui-idempotent 补了
    `makePng + setFiles`。Node 裸 fetch 上传（ui-idempotent 第 5 节）有个坑：
    `new Blob([buf])` 默认 `application/octet-stream` 会被内容类型白名单
    100001 拒掉，**必须 `{ type: 'image/png' }`**。ui-note 27 条含新增作者操作段
    （编辑回填/保存 / 下架按钮切换 + 作者仍可见 / 删除确认→首页→20001），
    复用当次发布的笔记，不额外消耗登录/注册限流。
  - interaction 组的「删除后详情页评论计数归零」断言原来是同拍短读，偶发读到
    旧值 flake；已按本文件惯例改成「先 waitFor 落定再断言」。
  - git 标签：v1.0（P11 收官 commit）。
- P12 响应式 + 纯文字笔记已完工（本 commit）：**后端零改动，契约仍 355 条**，
  CDP **199 条**（184 → 199：smoke 18→24、note 27→36；P12-C 追加 layout 组
  27 条后为 **226 条**）
  - **纯文字也能发笔记**：`utils/textCard.ts` 用 `<canvas>` 把标题+正文渲成
    **3:4 竖版文字卡片**（900×1200），正文按行数分页（首 13 行 / 续页 17 行，
    最多 6 页），逐页 `toBlob` → `new File([blob],'text-card.png',{type:'image/png'})`
    → 走**已有** `uploadImage` → `publishNote({imageUrls})`。
    **后端「图文必须带图」规则一行没动，前端自己把不变量满足了** —— 这就是
    小红书那套「文字用模板生成图片」的复刻。后端/契约/搜索/计数全不受影响。
  - 四个踩过的点：
    1. **canvas 读不到 CSS 变量**，`textCard.ts` 自带一份与 `main.css` 同名
       token 的调色板常量（`PALETTES`），改色要两边同步（文件头已注明）。
    2. **预览必须跟着主题重绘**：最初 watch 只监听 title/content/files，
       用户在发布页切深浅色时预览还是旧配色的旧图。修法是 watch 数组里加
       `useTheme().isDark`（两个视图都改了）。注意直接写
       `document.documentElement.dataset.theme` **不会**触发重绘 ——
       主题的真实状态在 `useTheme` 的 ref 里。
    3. **CDP 里 headless Chrome 的 `prefers-color-scheme` 是 dark**：
       首次进页面就是深色主题，写「浅色卡片」相关断言时别默认 light。
    4. **文字卡片排版只能靠像素分析验**（这台机上我读不了图）：临时脚本解码
       PNG、按行统计「非底色像素」找行段，确认真实落在
       品牌行 y≈70-114 / 标题 166-211 / 琥珀分隔线 244-256 / 正文 258-491 /
       落款 y=1136。这个脚本是临时的一次性工具，不入库。
  - **P12-B 桌面响应式**（原来 9 个页面的根容器全是 `max-width:480px`、
    **0 处布局 `@media`**，桌面打开就是一个 480px 竖长条 —— 这就是「网页版
    和手机版一样大」的根因）：
    - `.page` 骨架从 9 处重复收进 `main.css` 全局类，**scoped 样式里那份
      `max-width:480px` 必须删掉**，否则全局断点（特异性 0,1,0）永远打不过
      scoped 的 `.page[data-v-x]`（0,2,0）—— 这是最容易白干一遍的坑。
    - 断点两级：≥768px 过渡（640px 宽），≥1024px 桌面主力（1200px）。
    - **`SiteNav.vue`**：≥1024 才显示的顶部通栏（品牌+搜索+首页/发布/我的/
      关注/主题/退出），`<1024` 时 `display:none`，且首页自己的 `.top` 在桌面
      收起 —— 否则两条顶栏并排。登录页不挂（`route.name === 'login'`）。
    - 抄小红书的构图：首页/作者主页/搜索结果 = **CSS `columns:3` 瀑布**，
      卡片化（描边+硬阴影+`3/4` 封面），类名与 data-test 一个没动；
      详情页 = **左图右栏**两栏 grid。
    - 详情页两栏用**扁平子元素 + CSS grid 显式摆位**（`.title/.who/.content/
      .grid/.stats` 各自 `grid-column`），外层 `.detail-grid` 在移动端
      `display:contents` —— 这样移动端 DOM 顺序（标题→作者→正文→图片→计数）
      与改造前**完全一致**，只有桌面才换位。不要为了排版去重排 DOM 顺序。
    - 无图笔记（改图清空后）用 `:has()` 退回单栏居中，不留一整片空白左栏。
    - 补了桌面交互：`:hover`（以前**只有** `:active`，鼠标放上去毫无反应，
      这才是「按键不好」的真实来源）+ 全局 `:focus-visible` 焦点环。
    - `index.html` 去掉 `maximum-scale=1, user-scalable=no`（保留
      `viewport-fit=cover`）：桌面要能缩放，锁死缩放是无障碍问题。
  - 两条 CDP 新断言（都在 430×900 窗口里用
  `Emulation.setDeviceMetricsOverride` 切到 1280 再 `clearDeviceMetricsOverride` 切回）：
  smoke 查 SiteNav 显隐/`.top` 收起/`.page` maxWidth 在 1280 与 430 下
  分别是 1200 与 480 + **直接查样式表 CSSOM 里存在 `columnCount==='3'`
  的 ≥1024px 规则**（关注流在演示账号下可能为空，DOM 上没 `.items` 可量，
  所以查规则而不是查元素）；note 查 `.detail-grid` 计算出 `display:grid`
  且**图片左边缘 < 标题左边缘**（真几何断言），切回后两者对齐恢复单列。
  （P12-C 起首页是 4 列，这条断言已放宽成 `columnCount >= 3`。）
- P12-C 桌面返工 + 演示数据已完工（本 commit）：契约仍 355 条，CDP **226 条**
  （199 → 226：新增 layout 组 27 条）。上一版桌面被判定「只是把尺寸拉大」：
  - **六个硬 bug**（全部由 `ui-layout-audit` 的几何体检复核）：SiteNav 搜索框
    `.input` 不给 `flex:1 1 auto; min-width:0` 会溢出顶栏；计数器压字要靠
    `.field` 两行 grid（`minmax(0,1fr) auto`）而不是 `padding-right` 打补丁；
    文档级横向溢出 `doc=453/430`；详情图被基础规则的 `aspect-ratio:3/4` 裁切
    （**媒体查询必须放在基础规则之后**，同特异性下 source-order 决定胜负，
    ProfileView 与 NoteDetailView 各踩过一次）；首页 228px 空洞；桌面两条顶栏。
  - **桌面 token 覆盖块**放 `main.css` 末尾，selector 必须是
    `:root, :root[data-theme='dark']` —— 只写 `:root`（0,1,0）压不过暗色的
    `:root[data-theme='dark']`（0,2,0），暗色下整块白改。移动端保持 2px 粗描边
    + 硬阴影，桌面才切 1px + 软阴影（`--xk-stroke-w` / `--xk-shadow-hard` / `--xk-radius-blob`）。
  - **未定义 CSS 变量是「组件乱」的另一半根因**：`--xk-accent`、`--xk-text-1`、
    `--xk-surface-1` 全站根本不存在（真名是 `--xk-amber` / `--xk-text` /
    `--xk-surface-2`），`.submit` 因此是白字透明底、浅色下近乎隐形。改任何
    `var(--xk-*)` 前先确认它在 `main.css` 里有定义 —— **CSS 里引用未定义变量
    不报错**，只是静默按 inherited/initial 走。
  - **`frontend/scripts/ui-layout-audit.mjs`**（`test:ui:layout`，已并入 `test:ui`）：
    6 页 × 2 视口的几何体检（文本宿主 vs 控件两两矩形相交、`.page` 内横向溢出、
    文档级 `scrollWidth > innerWidth`）+ 桌面/移动 token 各一条。两个设计点：
    **登录页要在登录前体检**（登进去后 `#/login` 被守卫重定向回首页，量的是首页）；
    **详情页取有图笔记走关注流**（搜索关键词只会命中无图旧文，落到 `:has()`
    单栏兜底分支，两栏主分支就测不到）。计划 Track 4 的五条关键尺寸断言已补：
    ①首页 `columns=4` 且相邻列距>100px（取 `.items` 子项 left 去重）；②详情图列
    440±8（量 `.detail-grid .grid` 的实际宽）；③详情图 `object-fit=contain`；
    ④发布页**填满 64 字再量一遍**（原生 setter + input 事件喂 v-model，**不能 goto
    会清空表单**）—— 计数与输入不相交 + 文字卡预览存在且 `max-height≤480`；
    ⑤首页真封面 `naturalWidth≥1080`（`decode()` 等解码完再量，lazy 下 0 会假红，
    钉死 8×8 回归）。`node scripts/ui-layout-audit.mjs --report` 另出**量化体检表**
    （行长/首屏占用/字号直方图/WCAG 对比度/点击热区/卡片宽高比），只打印不断言。
    目前体检表暴露的已知项（有意未改）：`--xk-text-3` 系 meta/label 对比度 ≈2.1-2.5
    低于 WCAG AA；SiteNav 链接热区 48×31<40px；字号 16/18/21/26px 在计划字阶
    （12/13/14/15/17/20/24/30）之外 —— 收口属于 Track 1 的「间距/字号阶」配套，
    改动面是全部 9 个视图，留待用户拍板后再做。
  - **计划 Track 1/3 的三处收尾**（本轮补）：`main.css` 桌面块给 Vant 覆盖
    `--van-radius-sm/md/lg`（默认 2/4/8 太碎 → 6/10/16 对齐 blob；Vant 无 shadow
    变量，组件阴影改不了）；发布/编辑页桌面 `.card-preview` 限高 `420px + contain`
    （3:4 卡在 380 栏自然高 507px 会顶出首屏，`width:auto + margin-inline:auto`
    保比例不裁）；三处 `.count` 字号 11→12px 回到字阶内。
  - **`backend/scripts/seed-demo.mjs` 演示种子**：在页面里动态
    `import('/src/utils/textCard.ts')` 调 `brandCoverBlob` 出 1080×1440 封面
    （让 Vite 转译 TS，Node 侧零依赖）→ 真实 upload/publish。
    **登录限流 60 次/分钟（IP）**：令牌只在开头每账号登一次，之后切身份靠
    `localStorage` 换 token，全走 login 一定撞墙（实测会中途 429）。
    清掉的旧垃圾 113 篇（`xiaoku_demo` 58 篇 8×8 纯色碎图 + ct/idem/seed）。
  - 种子数据暴露的**两条测试真缺陷**（修的是测试的错误假设，不是迁就实现）：
    ① `ui-follow` 点**第一张**关注流卡片就当素材笔记 —— 素材笔记只发过一次、
    `createTime` 是旧的，种子笔记更新、排在它前面，于是取关取错人，
    「取关后素材笔记从关注流消失」永远等不到超时。改成**按标题找卡片**。
    ② `ui-interaction` 的「评论计数同步为 1」是同拍短读（列表渲染 ≠ 详情重拉
    的数字跟上），偶发读到 0，按 P11 的惯例先 `waitFor` 落定再断言。
- P13 字号/间距阶 + 文字卡模板 + 卡片内边距（本 commit）：契约仍 355 条，
  CDP **240 条**（226 → 240：ui-note 36→46、layout 27→31）。用户反馈
  「卡片排版不对、详情页展示不对」，两个真根因：
  - **根因一 `wrapText` 不认 `\n`**：逐字符排版把换行折进同一行，canvas
    `fillText` 又不画 `\n`，段落结构画成「一个空格宽的缺口」。改为按段切行、
    空行保留（`if (!text) return []` 防空内容多页）。像素复测（临时脚本，
    不入库）量墨带：行距恰 56、空行保留、正文不压落款 y≈1136。
  - **根因二 `.card` 从来没有 padding**：详情/发布/编辑/我的/搜索的卡片
    padding 历来是 0（git 历史查无规则，P12-C 几何体检不查 padding 所以没
    暴露），文字贴着 2px 描边。`main.css` 补全局 `.card { padding:
    var(--xk-card-pad) }`（18px，≥1024 覆盖 24px），scoped 里的字面量同步换 token。
  - **字阶/间距阶收口**（Track 1 遗留，拍板后本轮做完）：`--xk-fs-*`
    （12/13/14/15/16/17/20/22/24/30）+ `--xk-space-*`（4…48），全站
    `font-size: Npx` 机械归阶（11→12、18→17、21→20、26→24、28→30，leftover 0）；
    **文本输入框一律 16px**（iOS 聚焦自动缩放）；返回键/顶栏链接/模板按钮
    热区 ≥40px。
  - **文字卡 6 套模板**（paper/ink/amber/mint/blush/blue，palette 手算对比度
    ≥4.5:1）+ 发布/编辑页选择器（`tpl-list` / `tpl-{id}`）+ 预览分页器
    （`text-card-pager`，长文 `1/N` 翻页、缩回单页自动收起）。模板与 app 主题
    **解耦**（`defaultTemplateId()` 只给起步值：暗色→墨黑，之后跟人走）；
    `currentTextTheme` 删除。正文 30→32px / 行高 56。
  - **layout-audit 新增 4 条**（双视口 ×2）：详情卡 padding>0、发布页输入
    ≥16px。正是它们抓出这次的 Profile 桌面回归：全局 padding 让侧栏 `.names`
    从 112 压到 64px，`@xiaoku_demo`（88px）溢出压「编辑」按钮 —— 侧栏
    260→300px + `.username` 省略号兜底（长用户名本来就该省略）。
  - **ui-note 新增 10 条**：模板切换改预览 dataURL、`buildTextPages` 按 `\n`
    切行（模块级直接 import 断言）、长文分页器 `1/2→2/2` 且预览换图、缩回短文
    分页器收起、输入字号 ≥16px、详情卡 padding>0 + `white-space: pre-wrap`。
  - **调试可用的通用资产**：CDP `CSS.getMatchedStylesForNode` 查规则、
    「先 waitFor 登录序列再量」的诊断模板，本轮都验证过；一次性诊断脚本用完即删。
  - **v1.2 之后的截图反馈修复**：标题下分隔线压住正文首行 —— 线底 256 与
    32px 字 ink 顶 ≈256 是 **0px 间隙**（硬编码 `ty+12`/`ty+48` 叠放，两行标题
    318/318、续页 8px 同病）。`drawPage` 改语义化三段留白（标题→18→线 10→
    26→正文 ink 顶→24→基线），首基线 280→310 / 342→372 / 续页 140→174，
    最深 1070 仍 < 落款 1112。附带收益：横线纸模板的纸纹正好落到基线下
    6px，「字坐线上」不再穿字。**这台机器现在能直接读图**（Read 工具读
    `img/*.png`），修复前后用渲染截图逐张人工验收过，读不了图是旧结论。
  - **v1.2 之后的截图反馈修复（二）—— 详情页「多图遮挡不能切 + 标题正文
    一大片空白」**，CDP 240 → **244**（ui-note +4），契约仍 355：
    - **图改轮播**：`ul.grid` 摆全部图片 → `van-swipe`（VantResolver 自动
      注入，`van-swipe-item` 单张 CSS 齐全）。图框比例 `--img-ratio` 跟当前
      图真实宽高比走（竖图占满、横图 440×293 缩帧不留灰带）；桌面箭头
      ≥768 显示 + 计数器 `1/2`，手机靠手势。**不能加 `loading="lazy"`**：
      非当前张平移出可视框后浏览器判不相交就不加载，解码断言永远等不到。
      `van-swipe` 横向位移只依赖宽度，高度变化无需 `resize()`（源码已核）。
    - **两栏空白的真根因有两层**：① 旧 `grid-row: 1/-1` 在隐式网格里退化成
      单行，整摞图片高度灌进第一行 → 标题右下方空到作者行；修法是图框
      **绝对定位挂左栏** + 容器 `min-height` 与图框同源（`--media-h =
      min(660px, 72vh, calc(440px / var(--img-ratio)))`），右栏四块回归
      纯自动行。② 修完量出**每行之间仍空 106px** —— `min-height` 高出右栏
      内容总和时，默认 `align-content: stretch` 把剩余高度**摊进每个自动行**。
      补 `align-content: start` 后 title→作者实测 20px（=16 margin+4 gap），
      ui-note 断言 `< 40px` 钉死两层回归（旧值 70/106 都会挂）。
    - **layout-audit 终态等待**：`auditPage` 固定 700ms 在全量连跑时不够
      （idempotent 压完后端、首页关注流没回来就量 → `.items` 不存在报
      `cols=undefined`，单跑复现不了）。改成等 `feed-loading` /
      `follow-loading` 标记消失（超时按老节奏继续）。
    - 验收：1280/430 三张截图（竖图帧 440×587、横图缩帧、手机单列顺序
      不变）读图核对；临时诊断脚本 `_diag-detail.mjs` 用完即删，
      它发的临时笔记已走 DELETE API 清掉。
    - ⚠️ **本段描述的整套机制（绝对定位图框 / `--media-h` / `align-content:start`）
      已在第六轮整体删除** —— 它是为了「评论进右栏」才存在的，而用户要的是评论
      在照片下方。留着这段是为了说明**为什么不能**再用那套：一个跨栏共享行的
      网格不管怎么摆，右栏内容一变长，左栏的评论都会被顶下去。
  - **v1.2 之后的截图反馈修复（三）—— 点赞/收藏/评论吸底操作栏 + 三键降权**，
    CDP 244 → **269**（ui-note 50→60 +10、layout 31→46 +15），契约仍 355
    （纯前端，后端零改动）：
    - **结构**：`.stats` 三键块与 `.editor` 评论输入合并成一个
      `[data-test=action-bar]`，**放在卡片最底部（`.comments` 之后）**。
      一个 DOM 两种落位：移动端基础样式 `position:fixed` 吸底（fixed 脱离
      流，DOM 在哪儿都不影响它贴视口底；被遮的评论尾部靠 `main.page` 移动端
      `padding-bottom: calc(76px + safe-area)` 让位）；桌面 ≥1024 撤壳
      `position:static`，靠 `margin-left: calc(var(--xk-col1) + var(--xk-colgap))`
      与右侧文字左缘对齐 —— **左图下方留空**，两栏构图完全不变。
      桌面媒体块必须写在基础规则**之后**（同特异性 source-order 决胜负，
      ProfileView/NoteDetailView 的 `aspect-ratio` 已踩过两次）。
    - **列宽单一来源**：`--xk-col1`（440）/ `--xk-colgap`（32）/
      `--xk-col1-narrow`（620 无图单栏）定义在桌面 `.card` 上，网格列模板、
      图框宽度、`--media-h`、操作栏缩进全部取它 —— 写死两处就会出现
      「网格改了、缩进没改」且只在桌面显形的错位。
    - **三键降权**：删可见文字标签（`.cap`），只留图标+数字；`border:0`、
      `background:none`，激活只变琥珀；读屏/悬停用 `aria-label`/`title`，
      `data-test` 与 `aria-pressed` 原样保留（ui-interaction 全靠它们）。
      图标换 `<van-icon name="like|like-o|star|star-o|chat-o">`
      （VantResolver 自动引入）。`.kbtn` min 40×40（P13 热区）、
      `.num` 14px + `tabular-nums`。输入框改 pill：`rows=1` +
      `field-sizing:content`（40→140px 封顶）+ 发表按钮绝对定位在 pill 内
      右下；**flex 内 textarea 必须 `min-width:0`**（SiteNav 搜索框前科）。
    - **桌面正文/标题加码**（注意力回到正文）：`.content` 16→17px /
      line-height 1.75、`.title` 22→24px，都在字阶 token 内。
    - **重叠判定语义修正（不是绕过）**：吸底栏盖评论文字、发表按钮压
      输入框都是设计，`AUDIT_EXPR` 的 `nodes` 过滤 + 两两循环都跳过
      `[data-test=action-bar]` 子树；该区域几何改由 spec 断言专项管
      （双视口三键无边框/无底色/仅数字/热区≥40、移动端 fixed+贴底+
      发丝线、桌面 static+与标题左缘对齐+在评论区之下+正文17/标题24）。
      `auditPage` 终态等待对 `#/note/` 追加等 `action-bar` 出现
      （v-else-if=note，量早了 `spec.keys` 是 undefined 会假红）。
    - **ui-layout-audit 的 finally 吞错隐患（本轮真踩）**：`main()` 原来
      没有 catch，中途异常会穿过 `finally` 里的 `process.exit(0)` ——
      跑到 22 条就停却报「22/22 通过」。已加 `crashed` 标志：异常打印
      且以非 0 退出。看到断言数明显少于预期先怀疑这个，别信全绿。
    - 验收：1280 两张截图（顶部两栏、滚到底的操作栏落位）读图核对，
      诊断脚本用完即删。
- **v1.2 之后的第四轮 —— 详情页按「规格」重做**（用户连否三轮后的**流程
  修正**，不是又一轮微调）：CDP 269 → **300**（ui-note 60→74 +14、layout
  46→63 +17），契约仍 355（断言内容改了一处）。前几轮的教训：都在**猜**位置
  （吸底 → 右栏缩进 → 整卡通栏，被连否三次），根因是**没写规格**。这轮先量、
  再定规格、最后把规格变成断言：
  - **量出来的真问题**（`ui-layout-audit.mjs --report`，不是观感）：
    手机输入框 pill 只剩 242px、扣掉给发表按钮让位的 56px ≈ **170px ≈ 10 个
    汉字**；发表钮 **54×30**（热区不足 40）；桌面吸底区 **1120px** 通栏而正文栏
    只有 **648px**；主题切换钮是**空心圆**（`van-icon` 的 `::before` content 为
    `none`）。
  - **空心圆根因**：`ThemeToggle` 用的 `sun-o` / `moon-o` **在 Vant 4.10.2 的
    259 个图标里不存在**。`van-icon` 找不到对应 class 就只渲染一个空 `<i>`，
    外面 40px 的圆还在 —— 看截图才发现。已换成真实存在的 `bulb-o` / `circle`，
    并给 layout 加了**全站扫描断言**：`i.van-icon` 的 `::before` 必须非空
    （6 页 × 2 视口 = 12 条）。**写图标名前先查 `vant/lib/index.css` 里有没有
    `.van-icon-<name>` 规则**，别凭印象。
  - **两行吸底区**：`.actionbar` 基础样式 `flex-direction: column`。行1 输入
    胶囊**通栏**（430 下 406px，`padding: 11px 16px`），行2 左「发表」44×44
    圆形图标钮（`van-icon name="arrow"`）、右三键 44×44 键距 12。
    **DOM 要动**：`.c-send` 从 `.input-row` 搬进新的 `.bar-actions` 行 ——
    原来它绝对定位压在胶囊右下角，只靠 `padding-right: 56px` 让位，而 56px
    恰好等于按钮宽度，textarea 超过 `max-height` 内部滚动后滚出来的行直接
    走到按钮底下（用户说的"输入时遮挡"）。搬出来让位就不需要了。
  - **栏高不写死**：`ResizeObserver` 监听 `.actionbar` 高度写进 `--bar-h`，
    `.page` 的 `padding-bottom: calc(var(--bar-h, 112px) + var(--kb-inset, 0px))`。
    输入框是 `field-sizing: content` 多行自增的，栏会从 112px 长到 188px，
    写死 76px 必然在打字时盖住最后一条评论。
  - **软键盘遮挡（headless 验不了，只能真机）**：`index.html` 的 viewport 加
    `interactive-widget=resizes-content`（Android Chrome 键盘弹起时收缩
    layout viewport，fixed 栏自动落到键盘上方）；iOS Safari 不认这个键，由新增的
    `src/composables/useKeyboardInset.ts` 读 `visualViewport` 的
    `resize/scroll` 写 `--kb-inset` 兜底。**headless Chrome 没有软键盘，这条
    只能让用户在真机验**。
  - **两个栏容器 `.col-media` / `.col-text`（第六轮，用户明确要求后才改对）**：
    - **用户原话**：「网页端的评论放到照片下面，不然展开长文就会移动评论。移动端的
      照片放到全文上面。」—— 之前那版把评论塞进右栏正文下面，**行为正好相反**
      （正文一变长评论就被推下去），这一版才落实。
    - 桌面（≥1024）：`.card` 是两栏网格，**两个容器各占一列、各自独立堆叠** →
      左 = 图片 → 评论 → 操作栏；右 = 作者 → 标题 + 正文（作者在最上面、标题与正文相邻）。
    - **为什么必须是两个容器、不能一个网格逐个 `grid-column`**：网格的**行是跨栏
      共享的**。评论若放第 1 栏第 2 行，这一行的起点是「图片高」与「标题+作者高」
      的较大值，评论就被推下去了。分成两栏容器后行高互不影响 —— 实测
      **展开长文前后评论 `top` 都是 769，Δ=0**（ui-note 有断言钉住）。
    - 移动（<1024）：两个容器 `display:contents`，`.card` 改 `flex column`，
      靠 `order` 排出 `图片1 → 标题2 → 作者3 → 正文4 → 展开5 → 评论6`。
      **一套 DOM 出两种排布**，因为桌面要的顺序与移动端**互不相同**，单一 DOM
      顺序满足不了两者。
    - 顺带**拆掉了整套图片绝对定位机制**（`--media-h` / `min-height` /
      `align-content: start` / 图框 `position:absolute`）：那套是 P12-C 为了
      「评论进右栏、图片列不撑高」才加的，现在图片只是左栏普通流里的一块，
      高度由 `aspect-ratio` + `max-height:72vh` 决定就够了。
    - `:style="{'--img-ratio': ...}"` 仍留在 `<article>` 上（两栏都要继承它）。
  - **长正文折叠**（不做内嵌滚动框：滚动链、Ctrl+F 搜不到、手机像 App 套 App）：
    `.content.clamped` 用 `-webkit-line-clamp`，移动 8 行 / 桌面 12 行，
    配「展开全文」按钮（`aria-expanded`）。**溢出检测必须在折叠态量**
    （`scrollHeight - clientHeight > 4`）：展开后量会得到「没溢出」、
    按钮自己消失 —— 用 `measuring` 标志临时强制折叠一次，量完恢复。
    断 `display` 值是错的：Chrome 把 `display: -webkit-box` 归一成 `flow-root`，
    断言要断 `webkitLineClamp`。
    ⚠️ **测「展开后评论不动」的长正文必须是 20 段**：桌面阈值 12 行，12 段刚好
    被装下 → 不溢出 → 展开按钮**合理地不渲染**，断言会拿到 null。
  - **评论字数 500 → 1000**（对齐小红书真机，用户嫌 500 太短）：
    `comment.content` 是 **VARCHAR 不是 TEXT**，改上限必须四处同步 ——
    `sql/schema.sql` 列宽、`CommentCreateDTO` 的 `@Size`、前端 `COMMENT_MAX`、
    `contract-test.mjs` 的 `'字'.repeat(1001)` 断言。现有库要手动
    `ALTER TABLE xiaoku_db.comment MODIFY COLUMN content VARCHAR(1000) NOT NULL`
    （`sql/schema.sql` 挂在 `/docker-entrypoint-initdb.d/`，只在新库初始化时跑）。
    计数器改成**过 80% 才出现**（常驻 `12/500` 纯噪音）。
  - **配色**（新增 token `--xk-amber-text`，按主题给值）：单一颜色在
    「白底要够深、暗底要够浅」之间**无解** —— 白底要求相对亮度 ≤0.161
    （4.5:1），`--xk-surface` #4e5478 要求 ≥0.594。所以浅色给 `#8a5a00`
    （压白底 5.93:1）、深色给 `#f5cd7a`（压 #4e5478 4.86:1）。
    发表钮从硬编码 `#f5a623` + 白字（**2.03:1**）改成 `--xk-amber` +
    `--xk-amber-ink`（9.69:1，与 `.xk-btn` 同一套）。
  - **热区**：三键与发表 44×44；关注/编辑/下架/删除 28→40；SiteNav 品牌/搜索框/
    搜索按钮 38→40。layout 的**热区扫描断言**第一次跑就抓出 `brand 125x38`。
  - **layout-audit 的登录加重试**：login 按 IP 限流 60/min，全量连跑时前面 8 组
    刚把桶用掉，layout 登录会吃 429，表现为「超时：登录成功」（登录请求返回错误、
    页面根本没跳走）。已改成撞了就等 20s 重试，最多 3 次 —— **看到这个超时先
    怀疑限流，别当布局回归**。
  - **验收**：430 / 1280 各两张截图读图核对（移动吸底两行、桌面右栏评论区+
    两行操作栏、主题钮有字形）；4 个临时诊断脚本（`_shot` / `_diag-theme` /
    `_diag-icon` / `_check-icons`）用完即删。
- **v1.2 之后的第五轮 —— 移动端导航缺失 + a11y/交互审计整改**，CDP 300 → **353**
  （smoke 26 / refresh 8 / note 77 / profile 26 / interaction 51 / follow 25 /
  search 19 / idempotent 9 / layout 108），契约仍 **355**（本轮后端只改了评论
  字数上限那一处，已单独验过）：
  - **根问题：移动端整层导航不存在**。`SiteNav` 是 `≥1024px` 才
    `display:block`，`<1024` 时移动端每页只有自己的 `.top`（品牌+返回），
    想去「关注/搜索/我的」必须退回首页再点进去。新增
    `src/components/TabBar.vue`：底部固定 5 项（首页 / 关注 / **＋发布** /
    搜索 / 我的），发布凸起居中（44×44 琥珀圆钮），激活态 `--xk-amber-text`
    + `aria-current="page"`，点当前 tab 回顶部。
    - **图标名必须先查 `vant/lib/index.css` 有没有 `.van-icon-<name>` 规则**：
      `home` 不存在、`home-o` 才是（同 `sun-o`/`moon-o` 那次）。
    - **详情/编辑/发布/登录页刻意不挂**（`HIDDEN_ROUTES`）：详情页已有自己的
      吸底操作栏（z 60），两层 fixed 元素叠一起既挤又抢焦点。
      ⚠️ 这里的路由名必须与 `router/index.ts` 的 `name` 逐字一致：详情页是
      **`note-detail` 不是 `note`**（写错过一次，症状是详情页底部同时出现
      操作栏 + tab 栏）。
    - **留白跟着实际可见性走**，不写死 56px：`TabBar` 用 `watchEffect` 给
      `<html>` 打 `data-tabbar="on"`，`main.css` 里
      `@media (max-width:1023px) html[data-tabbar='on'] .page { --xk-tabbar-h: 56px }`
      消费。写死的话登录/发布/编辑/详情四页会凭空多出一段空白。
    - 断点由 CSS 媒体查询管，组件**不监听 resize**（监听会让「改窗口大小时
      标记过期」这种 bug 回来）。
  - **装了 Vercel 的 `web-design-guidelines` skill**（全局
    `~\.agents\skills\web-design-guidelines`）。⚠️ 装完要改 SKILL.md 里的
    guidelines URL：原地址是 `raw.githubusercontent.com`，**这台机直连与
    127.0.0.1:7897 代理都超时**，WebFetch 每次拉取都会失败；换成
    `cdn.jsdelivr.net/gh/vercel-labs/web-interface-guidelines@main/command.md`
    实测可取。**但要说清：它是 a11y/工程卫生清单，不含任何尺寸与位置规则** ——
    「大小不对、位置不对」它治不了，那部分靠规格 + 断言。
  - **审计整改（已修）**：
    - 触摸交互：`touch-action: manipulation` + 低透明度品牌色 tap 高亮
      （**不用 transparent**，直接透明会让点按毫无反馈，比闪白更难点准；
      更不能顺手写 `user-scalable=no`），弹层加 `overscroll-behavior: contain`。
    - 11 处表单控件补 `aria-label`（`ProfileView` 昵称框此前**连 placeholder
      都没有**；三个搜索框只有 placeholder）。
    - 时间改 `Intl.DateTimeFormat`（新 `src/utils/datetime.ts`），替换两处
      `createTime.replace('T',' ').slice(0,16)`。⚠️ 后端是**无时区的
      `LocalDateTime`**，`new Date('2026-10-01T16:40:00')` 按 ES2015 规范按
      **本地时间**解析，不会发生时区偏移；**不要**加 `'Z'`。
    - 未保存提醒（新 `useUnsavedChanges.ts`）：`onBeforeRouteLeave` 弹 Vant
      确认框 + `beforeunload` 拦刷新/关页；发布/编辑提交成功后 `markClean()`。
      ⚠️ `beforeunload` 会让 CDP 的 `Page.navigate` **卡住等原生对话框**，所以
      `ui-cdp.mjs` 里注册了 `Page.javascriptDialogOpening` → 自动
      `Page.handleJavaScriptDialog({accept:true})`。
    - **18 处导航改 `RouterLink`**（卡片 `.main`、作者 `.author`、SiteNav
      品牌 + 4 个导航、关注/粉丝/去发布/我的、编辑、返回首页）。**3 处
      `router.back()` 保持 `<button>`** —— 它是历史动作不是 URL 导航，规则本身
      就要求动作归 button；**12 处脚本内 `router.push/replace`**（表单提交后跳转、
      守卫重定向、列表分支）也不动。`<a><button>` 是非法嵌套，所以卡片主体与
      作者/关注按钮必须保持**兄弟节点**。
    - 6 处静态图补 `width/height`（头像 62/40、logo 36、吉祥物 168）；
      **封面图与文字卡预览刻意不补** —— 它们有 `aspect-ratio` 盒子占位，
      CLS 已被挡住，机械写属性反而会写进错误的值。
    - 打磨：`SiteNav` 去掉 `:focus-visible { outline: none }`（全局焦点环本来
      就在，之前被自己打掉了）；`h1,h2 { text-wrap: balance }` 防孤字；
      计数类加 `tabular-nums`；3 个 placeholder 补 `…`；用户名/昵称加
      `spellcheck="false"`、昵称 `autocomplete="off"`；6 个视图的错误段落加
      `role="alert"`；品牌名加 `translate="no"`。
    - **有意保留**：轮播的 `transition: aspect-ratio/height/min-height` 违反
      「只过渡 transform/opacity」，但那张静止图换 0.25s 平滑是 P12 起
      「图列不再撑出大空白」那套机制的手感来源，改成瞬变会明显跳变。代码里
      写了注释说明取舍。
  - **测试基建的三处整改**（都是被这轮的真实故障逼出来的）：
    - **登录抽成公共 `loginDemo(s, base, {attempts, onFilled})`**（在
      `ui-cdp.mjs`）：这段「goto → 点 .demo → 点 .xk-btn → 等 hash」原本在
      **8 个文件里各抄一份**，同一个坑要踩 8 次。带 20s × 3 次重试；重试里
      **先判断是不是已经在首页**（首次可能服务端已登录成功、只是 SPA 跳转慢，
      此时再 goto `#/login` 会被 `guestOnly` 守卫弹回，`.demo` 永远不出现）。
    - **布局审计的「加载终态」超时不再静默吞掉**：以前是 `.catch(() => {})`，
      于是「关注流还没回来」会被当成「关注流是空的」继续量，最后报出
      `cols=undefined` 这种看不出根因的假红。现在把结果带回 `auditOne`，
      显式断言「进了终态」（超时就是超时）。顺带把等待从 10s 放宽到 20s，
      骨架选择器从 `.page` 改成 `.page, .login`（登录页根元素是 `.login`）。
    - `ui-search` 的「搜不到」关键词从写死的 `绝无此词zzz999` 改成**每轮随机
      拉丁串**：`ik_smart` 把中文拆成单字 + `multiMatch` 默认 **OR**，所以
      「绝无此词zzz999」会被拆成 绝/无/此/词/zzz/999，库里**任何一条**含
      「无」「词」「在」的笔记都会命中（实测撞上 `xiaoku_demo` 那篇标题「空格」
      的笔记，`total=1`）。这与 AGENTS.md 17.4 记的是同一个坑。
  - **环境导致的 flake（本机实测，别当代码回归）**：内存只剩 1.1GB（用户
    Chrome 16 进程 + dev 栈 6 容器 + **prod 栈 7 容器**同时在跑）时，冷启动后
    **第一个请求能到 9s**，随后 366ms。撞上过：关注流「请求超时」、注册按钮
    挂起 >5s、登录「网络异常」、轮播轨道偶发未位移。对应处理：注册与幂等
    改成 `waitFor` 而不是固定 sleep；轮播轨道位移改轮询等它真的动；
    登录走公共重试。**全量连跑之间建议隔 45~90s**，否则 demo 的
    login 60/min 与 publish 20/min 会被前几组用光。
- **仍未修的已知缺陷**：`--xk-text-3` 系 meta/label/计数对比度 ≈2.5 低于 WCAG AA。
  牵连全站每一页的视觉，本轮刻意没动 —— 要动得单独一版给你看。
  **搜索仍是 OR 语义**：`ik_smart` 单字 + `multiMatch` 默认 OR，导致搜
  「绝不存在」会命中任何含「存」「在」的笔记。改 `operator: AND` 能收紧召回，
  属于产品口径变更，没擅自改。

### P3 已知缺口（不是遗漏，是当前阶段做不到）

- **草稿（status=0）分支仍没有创建入口**：下架（status=2）自 P10 起有接口可造，
  门禁已被契约 17.2 覆盖；但「投稿即草稿」的创建路径后端刻意不做，只有管理端
  做出来才能造出 status=0 数据。`NoteQueryServiceImpl` 里它的判断分支仍未实测。
- **`S3ImageStorage` 未实测**：本机没有 S3 端点，只验证了 `type=local` 分支。
  代码能编译但没跑过真实请求，别当成「已验证」。
- **笔记详情需要登录**：`/api/note/{id}` 带路径变量，无法用 `MvcConfig` 的
  精确匹配白名单放行；改前缀匹配会同时让发布/上传的语义变模糊。
  保持「默认全部需要登录」，取舍写在 `NoteQueryServiceImpl` 的注释里。
- **`bio` 清空后回不到 `NULL`**：MyBatis-Plus 配的是 `update-strategy: not_null`，
  只有 `null` 会被剔除，`''` 会真的写进去。所以「不传字段」和「传空串」语义完全不同：
  前者是保持原值，后者是清空。改资料时 `bio` 必须无条件提交，别写
  `if (bio) patch.bio = bio`（那会让用户永远清不掉简介）。
  推论：`bio` 一旦是 `''` 就再也回不到 `NULL`。

### P5 已知缺口（不是遗漏，是当前阶段做不到）

- **「下架笔记上取消点赞/收藏」会连带回滚**：`NoteInteractionServiceImpl.unlike`
  删关系 + 减计数之后调 `getDetail`，对 `status != 1` 抛 20002，
  `@Transactional` 把已成功的删除一起回滚。注释里写清了来龙去脉，
  要修得给「非本人可见的未发布内容」造一个内部旁路 —— 牵扯「路人有没有权
  在取消时读到草稿」的权限语义，留到做管理端时一并定。
  目前 P5 没有下架/编辑接口，这条分支**造不出来也没测过**。
- **契约测试只验 HTTP 报文，验不了前端封装层**：`get(url, params, config)`
  写错（把 `{ params: {..} }` 塞进 params）契约测试照样全绿，
  只有真机 CDP 才炸（已踩，见第 6.2 节）。改 `request.ts` / `api/*` 必须跑 CDP。
- **评论的 `comment_like` 只读不写**：回填了 `liked` 字段、schema 里有表，
  但 P5 没有评论点赞接口，前端也用不到 —— 别以为它「已经实现」。
- **S3ImageStorage 仍未实测**（同 P3，本机无 S3 端点）。
- **固定账号 xk_ui_interact**：`ui-interaction.mjs` 的常驻评论者，
  撞 `10003` 判通过，和 `xk_ui_smoke` 一样**不要清理**。

### P7 已知缺口（不是遗漏，是当前阶段做不到）

- **没用 IK 中文分词**：`NoteSearchDoc` 用的是 ES 默认 standard 分析器，
  中文基本按单字切，召回够用（「笔记」能搜到）但语义相关性远不如 IK。
  要换就改注解上的 `analyzer` + 装 IK 插件，重建索引。（<b>P10 已实现</b>，
  见上方 P10「IK 中文分词」段，此条保留仅作历史记录。）
- **`createTime` 用 Long 存 epochMillis 有 WARN**：`@Field(type = Date, epoch_millis)`
  配 `Long` 会被 Spring Data ES 判为不支持类型，实际落成 number 字段。
  排序（`SortOptions.of` 的 createTime desc）和检索都正常，但映射不是日期类型，
  将来做时间范围查询要注意写法。
- **点赞/收藏/评论计数不触发重建索引**（决策 D2）：卡片计数在回 MySQL 时现查，
  所以展示值是准的；ES 里的 `createTime`/标题快照不会随编辑更新 ——
  而 P3 至今没有编辑/下架接口，所以暂时没有漂移来源。
  真正要做的是 P8 的 Redis 计数 + 异步落库。
- **reindex 是全量重建**：删索引 + 从 MySQL 回灌，10 篇就 10 篇，量大了会慢，
  且期间检索会短暂失败。没做增量/双写，别在生产直接调。
