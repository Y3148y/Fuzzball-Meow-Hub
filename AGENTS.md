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
# 系统代理在 127.0.0.1:7897（PowerShell 的 Invoke-WebRequest 会自动用，
# git 不会）。直连 github.com:443 会失败，push 要显式带代理：
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
# 后端（需后端已在 8088 运行）→ 276 条
cd backend && node scripts/contract-test.mjs
# 换地址：XK_API_BASE=http://ip:8088 node scripts/contract-test.mjs

# 前端（需前端 5180 + 后端 8088 同时在跑）→ 18 + 8 + 17 + 26 + 41 + 25 + 19 + 9 = 163 条
cd frontend && npm run test:ui

# 单跑某一组：:smoke / :refresh / :note / :profile / :interaction / :follow / :search / :idempotent
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

删库不会删文件，图片还在 `backend/uploads/`（已 gitignore），要清就整个删掉。

前端 CDP 测试的常驻 fixture：`xk_ui_smoke`（登录冒烟）、`xk_ui_interact`
（互动搭子+常驻评论）、`xk_ui_follow`（关注流素材号，口令同为 `Xk@2026peer`）。
撞 `10003` 都判为通过，**三个都不要清理**。测试需要 Chrome，路径可用 `XK_CHROME` 覆盖。

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

## 7. 已完成状态（2026-09-29）

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

### P3 已知缺口（不是遗漏，是当前阶段做不到）

- **草稿 / 下架分支没有测试覆盖**：`NoteQueryServiceImpl` 里那段判断要靠
  `status=0` 或 `status=2` 触发，而 P3 没有编辑/下架接口，测试造不出这个状态。
  要覆盖得先加管理端接口。
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
  要换就改注解上的 `analyzer` + 装 IK 插件，重建索引。
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
