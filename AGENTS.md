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

⚠️ **代理记录已作废（2026-10-06）**：上面那段说"经代理 TLS 握手失败、直连反而通"
在本机**不再成立**。10-05 推送连续失败（`Recv failure: Connection was reset`、
`Failed to connect to github.com port 443`），直连 ls-remote 也失败，带代理才推成功；
但 10-06 又出现直连成功的情况。**结论：这个网络到 GitHub 的连通性会漂移**，
所以每次都按上面顺序实测判断，不要照抄结论。

### 2.1 git 署名邮箱必须与 remote 域名对得上（2026-10-06 踩过）

**GitHub 判定贡献归属看的是提交里记录的 author/committer 邮箱**，
跟「你在网站账号设置里绑的邮箱」是**两套互不相通的东西** —— 后者 GitHub 不会
主动拿去匹配历史提交。所以本地署名邮箱写错，代码照样推得上去、远端 SHA 照样对，
**但贡献图永远是空的**，而且不会有任何报错。

⚠️ **这个项目就中过 30 次**：全局 `~/.gitconfig` 里是
`14971050+y3148y@user.noreply.gitee.com`（**Gitee** 的隐匿邮箱，
`user.noreply.gitee.com`），而 remote 是 `github.com/Y3148y/...`。
GitHub 完全不认识 gitee.com 这个隐匿邮箱域名，于是 09-27 到 10-05 的
30 个提交一天不落，**全部归属不到任何账号**。
已改成 `3148555328@qq.com`（2026-10-06），并用空提交推上去验证：
`api.github.com/repos/Y3148y/Fuzzball-Meow-Hub/commits/<sha>` 返回
`author.login = Y3148y` —— 归属确认成功。

**为什么没早发现**：noreply 邮箱**不含真实邮箱**，所以既不泄露隐私、
也不触发任何安全告警，看起来完全无害。而且这台机器上 `ai` /
`springai-demo` / `InterviewGuide` 三个仓库都用了同一个全局邮箱，
问题不止一个项目（InterviewGuide 那个还是别人的仓库）。

**规矩**：

1. **新建仓库后、第一次 commit 之前**就核对一遍：
   ```powershell
   git config --get user.email; git remote get-url origin
   # 邮箱域名与 remote 域名对不上（github.com 配 gitee.com 邮箱之类）→ 先改
   git config user.email <该平台已验证的邮箱>
   ```
2. **换平台用不同的隐匿邮箱**是正常需求（隐私考虑），但**绝不能放在全局** ——
   全局是所有项目共用的，一个项目的身份会污染全部仓库。正确做法是
   **仓库级**：`git config user.email <隐匿邮箱>` 只作用于当前仓库。
3. **不确定归属是否生效时，用公开 API 自己验**，别靠"推成功了"就当完事：
   ```powershell
   $c = Invoke-RestMethod "https://api.github.com/repos/<owner>/<repo>/commits/<sha>" -Headers @{ "User-Agent"="chk" }
   $c.author.login      # 有值 = 已归属；null = 没归属
   ```
4. 历史提交要一起归属回来只能改写历史（`git filter-repo`）+ force-push，
   **代价是所有 SHA 变 + 所有 tag 失效要重打**。仅为贡献图不值得，
   除非用户明确要求。

其他固定前提：

- MySQL 容器绑定 **`127.0.0.1:3309`**（只对回环开放，刻意不对局域网暴露）
- Redis 容器绑定 **`127.0.0.1:6379`**（2026-10-05 补进 dev compose，理由见下面那条）
- Elasticsearch `9250`、Kafka `9092`、后端 `8088`、前端 dev `5180`
- 仓库根目录 `.env` 提供 `MYSQL_ROOT_PASSWORD`（**永不提交**）

⚠️ **dev 的 Redis 曾经是「借」来的**：dev compose 原来只有 mysql/kafka/es，
而 `application.yml` 的 Redis 默认指向 `127.0.0.1:6379` —— 开发期实际由**另一个
项目**（compose project `community`）的 redis 容器提供。那个容器一停，本项目后端
就起不来，而报错**藏在** `spring-boot-maven-plugin` 那句
`Process terminated with exit code: 1` 后面：

```
Caused by: RedisConnectionException: Unable to connect to Redis server: 127.0.0.1/6379
```

不往上翻日志会以为是代码问题。2026-10-05 已把 `redis` 服务正式加进
`docker-compose.yml`（只绑回环、`appendonly no`、带 healthcheck），
`docker compose up -d redis` 即可。以后**先看 `xiaoku-redis` 在不在**再排后端。

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
# 后端（需后端已在 8088 运行）→ 621 条
cd backend && node scripts/contract-test.mjs
# 换地址：XK_API_BASE=http://ip:8088 node scripts/contract-test.mjs

# 前端（需前端 5180 + 后端 8088 同时在跑）
# → 31 + 8 + 123 + 26 + 67 + 46 + 19 + 9 + 26 + 23 + 20 + 139 = 537 条
cd frontend && npm run test:ui

# 单跑某一组：:smoke / :refresh / :note / :profile / :interaction / :follow /
#            :search / :idempotent / :notification / :admin / :message / :layout
cd frontend && npm run test:ui:interaction

# 前端类型 / 构建
cd frontend && npm run typecheck && npm run build
```

契约测试每次跑会新建 `ct_/ct2_/ct3_/ct4_/ct5_/ct_mod<时间戳>` 等账号
（必须随机，固定账号会撞 `10003` 就测不到注册成功分支），**并留下它们的笔记和图片**。
`ct5_` 是 P7 搜索轮询的专用账号——搜索接口 60/min 限流，轮询用自己的额度
才不把断言账号的桶打空（50 次 × 500ms ≈ 25s 预算）。
`ct_mod<时间戳>` 是 P15 内容审核段的专用账号——发布 20/min/USER，
全文件 `note/publish` 出现 26 次，共用主账号必撞桶（详见 P15 段）。

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
5. ⚠️ **SQL 里带中文条件字面量时，只能用 `--execute=`，不能走管道 stdin**
   （2026-10-06 实测）：`"… WHERE title IN ('正常的咖啡探店记录')" --execute="…"`
   能匹配到行，改成 `$sql | mysql` 之后同一条语句 `target=0` —— 管道进来时连接
   字符集与 `--execute` 不同，中文字面量被按别的编码解释，于是**静默匹配不到任何行**。
   症状和「SQL 写错了」一模一样，但反过来：没有 ERROR，只有 0 行。要清中文命名的
   行，先用 `--execute` 查出 **id**，再用纯 ASCII 的 id 列表去删。

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
    ⚠️ **这条已于「prod ES 装 IK」一轮修掉，2026-10-04**：prod ES 现在
    `analysis-ik 8.17.6` 已装、`xk_note` mapping 已是 `ik_max_word`/`ik_smart`。
    过程中踩了三个坑，见下面「prod 栈运维」段。
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
  - ⚠️ **「吸底栏只 padding 不抬升」是个真缺陷，2026-10-04 已修**：原来
    `--kb-inset` 被当吸底栏的**内边距**（`padding-bottom: calc(8px + var(--kb-inset))`），
    于是 ① `--bar-h` 是 ResizeObserver 量 `offsetHeight` 得到的，**已经含键盘高度**，
    而 `.page` 的 `padding-bottom: calc(var(--bar-h) + var(--kb-inset))` 又加一遍
    → 键盘一开页面末尾就有**约 2 倍键盘高度**的死空白；② 栏本身被撑成
    「键盘高 + 112px」，靠那截空白把内容顶到键盘上方，位置碰巧对、机制是错的。
    现在改成 `bottom: var(--kb-inset, 0px)`（**只用来抬栏**），`padding-bottom`
    换成 `calc(var(--xk-space-2) + env(safe-area-inset-bottom, 0px))` —— 顺带补上
    safe-area，TabBar 与 `.page` 一直有、吸底栏漏了，刘海屏上键盘收起时按钮会压到
    Home 指示条。两条路径互不干扰：Android 收缩 viewport → inset=0 → `bottom:0`
    正好在键盘上方；iOS 不缩 → inset=键盘高 → 抬到键盘上方。
  - **headless 验不了「触发」，但能验「消费机制」**：往 `main.page` 上注入
    `--kb-inset: 300px` 就能验算术与 CSS，5 条断言钉死（ui-note 3 条 + ui-interaction
    4 条）：栏底边升 300px 到视口底之上、**栏自身高度与 `--bar-h` 不变**（← 双算
    回归钉子）、`.page` 底 padding = 栏高 + 300、滚到底最后一条评论完全露在栏之上、
    键盘收起后归位。另有 2 条静态断言读 `index.html` 的 viewport meta
    （必须有 `interactive-widget=resizes-content`，且不许锁缩放）。
    **唯一仍需真机的**：`useKeyboardInset` 的触发 —— iOS Safari 弹键盘时
    `visualViewport.height` 是否真的变小。那是浏览器行为，代码只能响应；
    修完之后即使触发时序有偏差，最坏也只是栏位置差一点，不会再出现 600px 死空白。
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
- **v1.2 之后的第五轮 —— 移动端导航缺失 + a11y/交互审计整改**，CDP 300 → **388**
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
  ⚠️ **这条已于「搜索召回收紧」一轮改掉**：现在用
  `minimumShouldMatch("50%")`，不是 `operator: AND`。实测（库里 163 篇）：

  | 关键词 | OR（旧） | AND | msm50（现） |
  |---|---|---|---|
  | 绝不存在zzq998 | **28** | 0 | **1** |
  | 书桌上的三盏灯 | **31** | 1 | 9 |
  | 通勤穿搭 | 3 | 1 | 1 |
  | 点赞 | 33 | 27 | 33 |
  | **毛球喵社** | 2 | **0** ❌ | **2** |
  | TCC 典型应用场景 / 折叠 / 发现 | 1/3/1 | 同 | 同 |

  **别改成 AND**：ik_smart 切出的 token 数与命中数经常对不上，「毛球喵社」这种
  品牌词会被判成 0 结果（表格里 AND 那一列唯一倒退的就是它）。用 `"50%"` 而不是
  固定整数 2：token 少时 50% 向下取整到 0，短词不会被误杀。
  契约 16.x 有两条钉住它：中文乱词 `total ≤ 3`（防太松）、中文实词 `total > 0`
  （防太紧）。两条都**不钉具体数字**（库里还有种子号/演示号/压测残留）。

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

### P14 发现流已知缺口

- **P14 发现流已完工**（本 commit）：`GET /api/feed/discover` + 首页两个 tab，
  契约 **378 条**（355 + 23，17.5 段）+ CDP **368 条**（358 + 10）
  - **排序三级**（`FeedMapper.pageDiscover`）：`EXISTS(我关注了作者) DESC`
    → `(like_count+collect_count+comment_count) DESC` → `create_time DESC,
    id DESC`。发现流**排除自己发的**（`n.user_id <> ?`）。
  - `authorFollowed` **不再写死 true**：`FeedServiceImpl` 抽出公共
    `assemble(notes, total, page, size, viewerId)`，两个流都用
    `UserFollowQueryService.batchFollowingIds` 实时判断。关注流原来靠
    「能出现在关注流里 = 已关注」推断，作者被逻辑删除时 `findUserVOMap`
    会缺条目；发现流更是混着已关注与未关注两种作者，必须实时算。
  - 前端：`activeTab` 默认 **`discover`**、`switchTab()` 换接口，
    tab 是 `<button role=tab>` + `aria-selected`（切 tab 是**动作**不是 URL
    导航，规则：导航归 a、动作归 button）；两个空态文案分开。
  - **连带必须改的测试**：`ui-follow` 进首页后要**先点「关注」tab**再等
    `feed-item`，否则整组挂在「feed 出现测试笔记」上（素材笔记不在发现流里）；
    `ui-smoke` 的昵称断言从首页 `.nickname` 改到「我的」页 `[data-test=me-nickname]`
    —— 首页资料卡 `display:none` 后 `querySelector('.nickname')` **照样找得到**
    （display:none 不出 DOM），断言会「通过」但验的是用户看不到的东西。
  - CDP 17.5 段刻意**不钉 total 的具体数字**（库里还有种子号/演示号/压测残留，
    写死数字每加一次种子数据就得重写断言），钉的是「集合关系 + 排序规则」：
    不含自己、全 `status=1`、`authorFollowed` 是布尔、已关注连成前缀、
    同档内互动量非递增、`size` 夹取、关注流回归。

### P14 发现流已知缺口

- **`ORDER BY` 全靠 filesort，没有索引支撑**：`pageDiscover` 的排序键是
  `EXISTS(子查询) DESC, (like_count+collect_count+comment_count) DESC,
  create_time DESC, id DESC`。前一个键是子查询结果、第二个是三列之和，
  **都无法进索引**。prod 库上 EXPLAIN 实测：
  `Using filesort` + `DEPENDENT SUBQUERY`（每个候选行跑一次 EXISTS，
  走 `uk_user_follow` 的 eq_ref，单次便宜但逐行执行）。
  **形状不对 ≠ 现在就有问题**，所以配了两个可复用脚本量过（见下）。

- **发现流 vs 关注流 实测（2026-10-04，600 篇数据集 / 8 并发 / 每目标 400 请求 /
  0 失败，`deploy/loadtest/feed-bench.mjs`）**：

  | 目标 | p50 | p95 | p99 | max |
  |---|---|---|---|---|
  | discover p1 | 24.6 | 80.5 | 245.0 | 349.7 |
  | discover p5 | 26.6 | 97.1 | 285.2 | 366.1 |
  | discover p25 | 27.8 | 97.0 | 266.0 | 396.4 |
  | follow p1 | 14.0 | 48.3 | 151.1 | 313.1 |
  | follow p5 | 13.4 | 52.5 | 136.8 | 255.3 |

  **判读**：discover 是 follow 的 1.7~1.9×，但绝对值 80~97ms 远低于项目自己的
  p95 预算 600ms（k6 thresholds）。深页几乎不额外变贵（p5→p25 的 p95 基本持平），
  因为 filesort 的开销主要在**行数**而不是 OFFSET。**所以现在不上 `hot_score`
  物化列** —— 那要付出「异步刷列 + 漂移」的确定成本，换一个当下量不出来的收益。
  **重测的触发条件**：笔记数 > 5000，或 discover p95 > 200ms。届时再跑
  `node deploy/loadtest/seed-big.mjs --authors=20 --notes=60` 加量后重测。

- **压测脚本两个坑（都踩过，别重复）**：
  - **固定顺序量目标 = 废数据**：每个 VU 按同一顺序打 5 个目标时，排第一的那个
    独吞了 JIT/连接池/查询缓存冷启动的全部成本。实测量出 `discover p1` 68.6ms
    比 `discover p25` 36.2ms 还慢的荒谬结果。`feed-bench.mjs` 现在先预热 15 轮
    再按 VU 轮转起点。
  - **页码超出数据集 = 假深页**：数据只有 119 篇时 `page=25`（offset 480）直接返回
    空集，耗时天然更低，看着像"深页更省"。脚本现在统计空集率，超过一半就打警告。
  - `seed-big.mjs` **必须做限流退避**：publish 是 20/min/用户，不退避时
    `--notes=60` 会静默丢掉 2/3 数据（480 篇里失败 320）而脚本只打印一行「失败=N」。
  - 造出来的 `xk_big_*` 账号/笔记与 prod 库里的残留清理见第 5 节的 SQL 模式，
    正则换成 `'^xk_big_'`。**prod 是给人看界面的，别留着 `xkbigA8N60_1_1` 这种
    标题当演示数据**，量完就清，要量再跑 seed。
- **互动量排序读的是 note 表的三个计数列，而它们是 Redis 权威值的异步落库产物**
  （P8 `NoteCounterFlushJob` 每 30s 刷一次）。所以**刚发的笔记会有最长 30s
  排在比它热度低的老笔记后面**，随后自动纠正。这里刻意不逐条 `ZCARD`：一页 20 条
  要读 3 个 ZSet 的全部成员，代价远大于排序本身。这条取舍写进了
  `FeedMapper.pageDiscover` 的注释，别当 bug 反复"修"。
- **只出首页 20 条，没有翻页**：发现流与关注流都只请求 `page=1&size=20`，
  没有「上拉加载更多」。真要加得引入页码状态 + `IntersectionObserver`，
  且注意 `OFFSET` 深分页会越来越慢（同一根因）。
- **默认 tab 是「发现」**：因为关注流对一条关注都没有的新用户永远是空的。
  代价是已关注的老用户进首页第一眼看到的是全站流而不是关注流，得多点一下。
  这是产品取舍，不是 bug。

### P15 通知 + 收藏 + 内容审核（本 commit）

契约 **436 条**（382 + 通知 27 + 收藏夹 12 + 内容审核 15），CDP **414 条**
（388 + `ui-notification` 26）。

- **通知中心**：新 `module/notification/`（实体 / 类型枚举 / Mapper / VO /
  Service / Controller）。接口 `GET /api/notification/list?onlyUnread=`、
  `GET /api/notification/unread-count`、`POST /api/notification/{id}/read`、
  `POST /api/notification/read-all`。类型 `1` 赞笔记 / `2` 评论 / `3` 赞评论 /
  `4` 关注 / `5` 回复。
  - **写入一律 afterCommit + try/catch 吞异常**：通知失败不该把点赞、评论、
    关注一起回滚（用户已经看到「已点赞」了，再撤销才是真的坏体验）。
  - 去重靠 `uk_notify_once(receiver_id, actor_id, type, target_id)`：同一接收者 +
    同一操作者 + 类型 + 对象只有一条；重复互动走 `UPDATE` 把 `is_read` 改回 0、
    `content` 刷新，**不动 `create_time`**（它仍是首次发生的时间，列表排序稳定）。
  - 不给自己发通知（发起点就是操作者本人）。
  - ⚠️ **`note_id` 必须允许 NULL**：关注通知没有笔记，被 `target_id`（此时是
    receiver 的 userId）填进去的话，前端「去这条笔记」会跳到一篇不存在的笔记。
    `sql/schema.sql` 改成 `note_id BIGINT NULL`，**存量库要手动 ALTER**。
  - ⚠️ **`unread-count` 返回 `Result<Integer>`，不是 `Result<Long>`**：`Long` 会被
    第 6 节的 `ToStringSerializer` 序列化成 `"0"`，而前端要的是数字。
  - ⚠️ 前端铃铛**只挂在 `SiteNav`（≥1024px）里**，移动端入口放在「我」页一行。
    最初做成全局固定铃铛，430px 下直接压住顶栏的主题切换与返回键（实测重叠）。
  - `useUnreadCount.ts` 是**模块级单例**：`App.vue` 在路由变化时刷新，
    `NotificationBell` / `ProfileView` 共用同一个 ref，否则两处各请求一次还会
    各自维护一份数字。
  - CDP 断言里有一条**不能只判「元素在不在 DOM 里」**：
    `notification-bell` 挂在 `display:none` 的 `SiteNav` 内，子元素的
    `getComputedStyle().display` 仍是 `flex`（父级隐藏不改变子级计算值）。
    判「用户看不看得见」要看**盒子面积**（`getBoundingClientRect()` 宽高为 0）。

- **我的收藏夹**：`GET /api/note/collections?page=&size=`（**不收 userId** ——
  收藏夹是私有数据，能传 id 就等于可越权查别人的收藏）。实现落在
  `NoteCollectMapper.pageCollectedNotes` + `NoteQueryService.pageMyCollections`。
  - 只返回 `status=1`：下架的笔记点进去会撞 20002，给一条点不开的条目没意义。
    契约里有一条专门钉「下架 → 从收藏夹消失 → 上架 → 回来」。
  - 排序 `collect.create_time DESC, c.id DESC`；`authorFollowed` **实时算**，
    不能用「能出现在收藏夹里 = 已关注」推断（收藏夹里全是别人）。
  - 前端 `/collections`，移动 2 列 / 桌面 4 列瀑布。

- **内容审核**：新 `module/moderation/`（`TextModeration` 接口 +
  `DefaultTextModeration` 词库实现 / `ImageModeration` 接口 + `NoopImageModeration`）。
  错误码 `CONTENT_SENSITIVE(60001)`，接在**发布、编辑、评论三个入口**
  （`NoteServiceImpl.validatePublishParams` 是 publish/update 共用的，
  挂在里面 = 编辑改标题同样过审，否则「发的时候干净、编辑时塞进去」是后门）。
  - **词库是占位表**（`backend/src/main/resources/moderation/words.txt`，5 条），
    上线前必须换完整词表 —— 仓库里这份只用来让链路有真实数据流过。
  - 匹配前做 **NFKC 归一 + 转小写 + 压缩连续重复字符**：全角大写变体
    （`ＸＫ－ＳＰＡＭ－ＭＡＩＬ`）与填充重复（`地下地下地下钱庄`）都要同样命中。
    契约里有两条分别钉这两种绕过。
  - **长度 <2 的词条在读取时丢弃**：中文单字词（`钱`、`赌`）误伤率极高，
    宁可漏拦也不要把正常笔记全拦下来。
  - ⚠️ **读词库必须先 `strip()` 再判 `#` 注释**，否则满缩进的注释行会被当成词条
    收进去（首次实现把 4 条词库读成了 14 条，等于在拦正常内容）。启动日志里
    `敏感词库已加载：N` 的 N 就是词条数，**数字不对先查注释过滤**。
  - ⚠️ **词库读失败 / 缺失是 fail-open + WARN**：审核服务挂了不该让全站发不了笔记。
  - ⚠️ **60001 的 message 绝不回显命中的词**：告诉用户「你哪个词被禁」等于给了
    绕过办法（换个同义词就行）。命中的词只进服务端日志。
  - ⚠️ **评论审核最初是假绿的**：`textModeration.check(comment.getContent(), ...)`
    被写在 `comment.setContent(...)` **之前**，那一刻实体字段还是 null，
    而 `check` 对 null 直接放行。必须审 `dto.getContent()`。
    这条只有**真实调用**才发现 —— 契约 17.7 是照着「发布能拦」的直觉写的，
    先写断言就会绿。
  - **图片审核默认关闭且仓库里没有真实实现**：`NoopImageModeration` 只做一件事 ——
    在日志里说清「图片未审核」，避免有人以为这条链路已经过了风控。
    把 `xiaoku.moderation.image.enabled` 置 true 只会多打一条 ERROR 日志。
  - 契约 17.7 **用独立账号 `ct_mod<stamp>`**：发布是 20/min/USER，而
    `contract-test.mjs` 全文件 `note/publish` 出现 26 次，挂在主账号上会撞桶，
    症状是某次 publish 莫名其妙返回非 0、后面整段连锁假红
    （踩过：第一次跑 427/432，5 条假红全是这一个原因）。`ct_mod` 前缀仍匹配
    第 5 节的清理正则 `^ct[0-9]?_[a-z0-9]+$`。

### P15 已知缺口

- **通知只增不清理**：没有「保留最近 N 条」的定时清理，`notification` 会无限增长。
  用户明确说了本轮不做（先有功能再补运维）。每跑一次 `ui-notification.mjs`
  会给 `xiaoku_demo` 留 1~2 条通知，属预期。
- **通知列表没有分页**：`GET /api/notification/list` 默认 `size=20`，
  前端只取第一页，没有「加载更多」。
- **收藏夹没有分页 UI**：`/collections` 只取 `size=50` 一次。
- ~~「取消收藏」只从列表移除~~ **已修**：`CollectionsView.remove()` 现在先
  打 `DELETE /api/note/{id}/collect` 再改本地，失败时保留该条并 toast 原因
  （不做乐观更新 —— 这里的回滚就是「什么都不改」，比维护快照更不容易出错）；
  按钮在请求在飞时 `disabled` 并改文案，防连点发两次。
  CDP 那条钉住它的断言是**「刷新后仍然不在」**：只 `list.filter` 的实现当场
  看着是对的，断言也拦不住，只有重新进页面才拦得住。
- **审核词库是占位表**（见上），且只审文本：昵称 / 个人简介（`PROFILE` 场景
  已在枚举里）尚未接入 `ProfileView` 的更新路径。
- **没有语义审核**：词表命中挡不住「换个说法」的违规内容，真实平台需要
  模型或第三方内容安全 API。当前实现刻意只做词表，不做假的语义判断。

### P15 测试基建：两个「报绿但其实没跑完」的坑

这两个都是本轮真的踩到、且症状都是**「结果看起来是绿的」**，值得单列：

1. **`finally` 里 `process.exit()` 会把异常变成「通过」**
   （`ui-layout-audit` 已犯过一次，`ui-notification` 又犯了一次）。
   写成 `catch (e) { /* 忘了 */ } finally { const allOk = await s.close();
   process.exit(allOk ? 0 : 1) }` 时：异常穿过去 → `close()` 把已跑过的断言
   正常汇总 → **打印「13/13 通过」、退出码 0**。实际只跑到一半。
   本轮的具体触发点是 `s.check(` 误写成 `check(`（ReferenceError），
   顺带把末尾的清理也跳过了，于是库里攒出 3 条 `colprobe*` 垃圾笔记。
   **规矩**：入口必须是 `try { … } catch (e) { crashed = e } finally {
   if (crashed) console.error(…); … process.exit(crashed ? 1 : …) }`，
   临时数据（探针笔记之类）的清理要放在 `finally` 里、且不能只写在 happy path。
   看到断言数明显少于预期，先查这个，别信全绿。
2. **自造的用例不能假设「库是干净的」，也不能假设「第一行就是我造的那条」**
   `ui-notification` 最初是「读-all → 造一条通知 → 点第一行跳转」。两处都脆：
   通知**跨轮累积**（`xiaoku_demo` 已有 50 条历史通知），第一行未必是这次点赞
   产生的那条，点它会跳到别的笔记，然后 `waitFor` 永远超时；
   而点赞如果上一轮崩在清理之前就一直是「已赞」状态，PUT 返回 30001、
   **本次根本没有新通知**（当时那条断言写成 `code===0 || code===30001`
   判通过，把这个问题盖住了）。
   修法：① 用例开头 `DELETE /like` 复位（幂等，返回码不用管）；
   ② 点赞必须断言 `code===0`，别把 30001 当通过；
   ③ 定位那一行用**笔记标题**匹配，不用 `:first-child`。
   **断言里写「A 或错误码 B 也算过」要非常小心 —— 那往往是在给自己的
   测试不稳定性开口子。**


### P16 「谁赞了 / 谁收藏了」（本 commit）

契约 **457 条**（436 + 21，17.8 段），CDP **424 条**（414 + 10，ui-interaction）。

- 接口 `GET /api/note/{id}/likes` 与 `GET /api/note/{id}/collects`，都返回
  `PageVO<FollowUserVO>`。数据本来就在 `note_like` / `note_collect` 表里，
  P5 只做了计数方向，这次补上反向查询 —— **计数和名单是两件事**：
  计数只给人一个数字，名单才带来社交感。
- ⚠️ **可见性门禁抽成了 `NoteQueryServiceImpl.requireVisible(noteId, currentUserId)`**，
  与 `getDetail` 共用同一份实现。这两个端点也是「这篇笔记的读取入口」，
  各自写一份门禁迟早漏一处，结果就是「下架的笔记正文打不开、但点赞人列表
  能拿到昵称头像」，等于门禁只做了一半。契约里两条专门钉这个。
- 刻意**不提供**「某人的整个收藏夹」查询：收藏夹是私有数据，对外暴露等于
  允许越权遍历他人收藏（P15 收藏夹的接口因此不收 userId）。
- 分页在控制器里 `safePage / safeSize` 夹取（controller 已有 4 个分页端点，
  逐个重复 `Math.min(Math.max(...))` 只会抄错一次）。
- 前端**复用 `FollowListView`**，靠**路由名**区分四种模式
  （follow / fans / likes / collects），而不是靠参数名 —— 后两者按笔记查、
  前两者按用户查，路径参数都叫 `id`，靠参数名区分迟早在某页把 noteId
  当 userId 传过去。列表与加载态都挂了 `:data-mode`，四条 CDP 断言靠它区分。
- 入口**没有**做成吸底三键的一部分：三键是「点了就切换状态」的动作按钮，
  再塞一个「点了就跳页」的行为进去，同一控件两种语义，`aria-pressed` 与
  导航互斥，键盘和读屏都讲不清。所以另外起一行文字链接 `.interacts`
  （`note-likes-link` / `note-collects-link`），计数为 0 时整行不渲染。
- 两个踩过的点：
  - `get()` 返回的是 `{ json, ... }` 而**不是响应体本身**。契约里漏写
    `.json` 时 `p1?.data?.list?.length` 拿到 undefined，症状是「分页断言
    说拿到 undefined」，看不出是参数没生效还是取值写错。
  - 「1 人赞过」这条断言必须在 like=1 的时刻做（ui-interaction 里就是刚
    点完赞那两行之间）。写成「发布后立刻断言」会拿到 0，然后断言永远红。
- **契约注册频率是 10/min/IP**：连着跑两遍契约，第二遍会在第一个注册就
  100005 失败，然后**整份文件连锁假红**（实测 323/456，几百条全红但没一条
  与代码有关）。看到大面积失败先确认是不是这个，隔 90 秒重跑。

### P17 话题 + @提及（本 commit）

契约 **488 条**（457 + 31，17.9 段），CDP **435 条**（424 + 11，ui-note）。

话题是小红书内容组织的骨架：没有话题，笔记之间就是孤岛，搜索只能靠关键词撞上。

- **三张新表**：`topic` / `note_topic` / `note_mention`。表结构变更，**存量库要手动建**
  （`sql/schema.sql` 只在新库初始化时跑）。
- `uk_topic_name` 上 `INSERT IGNORE`，**不靠「先查再插」**：两个用户同时发「#咖啡」，
  先查后插会让两个事务都查到「不存在」然后都去 insert，第二个撞唯一索引异常一路冒到
  接口变成 500。竞态收进 SQL 内部，谁先插成功另一个静默跳过。
- `note_count` **不落库**，查询时子查询现算。话题表本身很小，一页 20 行的关联统计
  比维护一列异步计数简单且不会漂移 —— 真问题不是「算得准不准」而是「为它付出多少」。
- 接口 `GET /api/topic/list`（热门榜）与 `GET /api/topic/notes?name=`（话题页）。
  话题名**带不带 # 都认**（页面 URL 里 # 是 fragment，两边都得支持）。
  不存在的话题返 `70001` 而不是空列表 —— 空列表在页上和「这个话题还没内容」
  长得一模一样，用户会以为自己被吞了内容，真因是拼错了名字。
- `ErrorCodeEnum` 新增 `TOPIC_NOT_FOUND(70001)`、`NotificationType` 新增
  `MENTION(6)`。通知在发布/编辑成功后发，与其它通知一样 afterCommit + 吞异常。

**`#话题` 的正则必须排除中英文标点**（实测出来的）：

```
#([^\s#@\uFF0C\u002C\u3002\u002E\u3001\uFF1B\u003B\uFF01\u0021\uFF1F\u003F\uFF1A\u003A]{1,20})
```

正文「还有一个 #很长很长的话题名字」如果允许逗号，会解析出「很长很长的话题名字，**和**」
这种把标点和后半句一起吞进去的话题 —— 用户完全没意识到自己建了个含逗号的话题，
而话题页会按这个名字聚笔记。**不排除** `- _ ~ /` 等连接符，
因为「#iPhone」「#618大促」「#C++」是真实存在的写法。

- 关系行**全量替换**（删旧插新）而不是增量 diff：编辑本就是全量覆盖语义，
  行数很少（一篇最多 5 话题 10 提及），删了重插最不容易出「改了正文还挂着旧话题」
  的残留。删笔记时也要清（无外键不级联）。
- **前端与后端各有一份解析正则**（发布页的输入预览）。不共享：后端 Java、
  前端 TS，共享要靠「后端下发规则」或改语言，代价远大于收益。但两处都写了
  「改一处要同步另一处」的注释，否则两边漂移的症状是「输入时看见话题、
  发布后详情页没有」。

四个踩过的坑（都写进了契约 17.9）：

- `@提及` 渲染成链接，**昵称和用户名都要建表**。正文里写的是 `@xk_ui_follow`（用户名），
  而 `NoteMentionVO` 原本只回 `nickname`「关注搭子」，拿昵称去正文里找**找不到**，
  于是整段渲染成纯文本 —— 而**界面看不出任何异常**，只是那一段不会跳而已。
  现在 VO 两个字段都给。
- `TOPIC_PATTERN` 里写中文标点字面量会因源码编码问题变成乱码并**静默失效**，
  改用 `\uXXXX` 转义。同一个正则前端也要同步。
- 发布页改值必须走**原生 setter + 派发 input**：直接 `el.value = x` 不触发
  Vue 的 v-model，预览是 computed，界面不更新。而直接调 setter 而元素不存在时
  报的是 `Illegal invocation`，与「找不到输入框」毫无关系。
- 话题段末尾**不能删掉那篇笔记就完事**：后面几十条断言全都量它的详情页 DOM。
  直接删，之后每条 waitFor 都超时，最终报出来的是
  「getComputedStyle: parameter 1 is not of type Element」，与真因隔了整屏。
  所以要重新发一篇把浏览器停回详情页。

⚠️ **本轮抓到一个与话题毫无关系的问题**：插入「话题关系行」时，编辑器把上一段
ES 事件的注释和**它下面那行 `registerAfterCommit(ACTION_PUBLISH, ...)`** 一起当成
注释的延续删掉了。结果是**发布不再发 Kafka 事件**，而接口照常返回 200 ——
只有契约里「发布后经 Kafka 异步入搜索索引」那条红。它是唯一发现这件事的地方。
**教训：往一段代码中间插东西时，先确认下一行不是被误删的候选**；
「插入式改动」最危险的失败模式就是它顺手删掉了紧随其后的语句。

⚠️ **契约测试自身的两个结构性问题**（本轮花了不少时间才定位）：

1. **跨段共用的可变 ID 是这类大文件测试的固有风险**。全局那个 `noteId` 在 P5 段
   末尾就被 DELETE 掉了，而 14 段的自评、17.1 编辑、17.2 上下架都在用它 ——
   于是从某个版本起 14 段开始整段假红（20001 笔记不存在），后面几十条连锁失败。
   症状极具迷惑性：最先看到的是「作者可以评论自己的笔记」失败，
   而「自评被放开」这个功能跟它八竿子打不着。
   **规矩：新增用例一律自建数据，不复用前面段留下什么。**
2. **改这个文件时必须守住三条不变量**，否则 JS 会静默变成另一个程序：
   ① 全文花括号净额 = 0；② `main()` 体内「深度 2→1」的出现次数不变
   （HEAD 基准是 8，多一次就说明有个块提前闭合了）；③ `node --check` 通过。
   本轮有一次「把复原语句插到块闭合之后」，`oldNoteId` 直接变成 undefined，
   而**语法完全合法** —— 只看语法检查发现不了。
### P18 举报 + 黑名单（本 commit）

契约 **529 条**（520 + 9，18.1 段），CDP **443 条**（435 + 17，ui-follow：follow 26→43）。

有了内容审核词表之后为什么还要这两张表：**审核只能在发布那一刻拦一次**，
词表也可能漏。真实社区的兜底是「用户举报 + 人工处置」，没有举报入口，
违规内容只能靠运营每天翻数据库捞。

- **两张新表**：`report` / `user_block`。表结构变更，**存量库要手动建**。

## 举报 = 公共治理，黑名单 = 私人屏蔽

这两个是同一个问题的两面（同一个举报弹窗里通常带「同时拉黑」），
但**性质完全不同**，混着实现会让人以为它们是一套机制：

| | 举报 | 拉黑 |
|---|---|---|
| 是否通知对方 | 是（作者收到「内容被举报」） | **否** |
| 去重维度 | `(reporter, type, target)` | `(user, blocked)` |
| 效果 | 记一条待运营处理 | 改变「我」的视野 |

- `uk_report_once(reporter_id, target_type, target_id)` 不只是为了去重：
  没有它，运营后台会被一个人的重复举报刷屏，而真正的举报淹在里面。
  换个人举报同一条**应该**成功（去重维度含 reporter）。
- 错误码段位用 **8xxxx**（内容治理），与 6xxxx 的审核分开：审核拦的是
  「**机器判定**违规」，举报处理的是「**人举报**」，运营后台要分开看这两类。
- `NotificationType.REPORTED = 7`，文案刻意**不回显举报人身份** ——
  那等于让举报人暴露，从此没人敢举报。
- **举报只是记录，不自动处置**：删内容/禁言是运营的权限，需要审核与申诉流程。
  「举报即隐藏」会让任何人都能靠批量举报让别人的笔记消失。

## 拉黑必须**双向**生效

`UserBlockMapper.selectHiddenUserIds` 用 `UNION` 取两个方向：
我拉黑的人 + 拉黑我的人。做成单向的话，「拉黑」就成了一个只能自己藏别人、
但藏不住别人的按钮，与现实里的直觉相反。

- 过滤在 **SQL 里**做（`AND n.user_id NOT IN (...)`）而不是查回来再筛 ——
  否则 `total` 会和 `list` 对不上，分页会出现「明明 total=20 却只显示 18 条」。
  注意 `@Select` 里用了 `<if>/<foreach>` 就**必须用 `<script>` 包裹**（见下）。
- 覆盖面：首页**两个流**（发现 + 关注）、作者主页、笔记详情。
  后两个走 `NoteQueryServiceImpl.requireVisible`（与 `getDetail` 共用，
  所以点赞人/收藏人列表也一并被挡住），前两个走 `FeedMapper`。
- 详情页按「**不存在**」（20001）处理，**不给「TA 拉黑了你」任何提示** ——
  那等于把对方的操作暴露出去，会把普通屏蔽变成社交对抗。
- 刻意**不因拉黑而取关**：关注是「我订阅了 TA」，拉黑是「我不想看到 TA」，
  两者独立。这样「取消拉黑」之后还能看到历史关注内容。

### ⚠️ 注解里的动态 SQL 必须用 `<script>` 包裹

`@Select` 里写 `<if>/<foreach>` 时，MyBatis **只认被 `<script>` 包住的字符串**
才会当动态 SQL 解析，否则它们被当普通文本，foreach 里的 `#{id}` 变成一个
「找不到的具名参数」，报：

```
BindingException: Parameter 'id' not found. Available parameters are [hiddenIds, userId, ...]
```

症状离真因隔了一屏 —— 报错说的是参数名，不是「你忘了 script 标签」。

**包上 `<script>` 之后又有第二个坑**：SQL 文本会被当 XML 解析，所以
**不能出现裸的 `<` / `&`**。原来的 `n.user_id <> #{userId}` 就是非法 XML，
启动时直接 `SAXParseException: Error creating document instance`，
报错说的是「创建 document 实例失败」，与 SQL 语法毫无关系。
MySQL 里 `<>` 与 `!=` 等价，换成 `!=` 绕开转义。

另外 Java **文本块**要求 `"""` 之后必须紧跟换行，所以 `<script>` 不能与
开分隔符同行 —— 要写在下一行。

### 两条「报错离真因很远」的自测教训

1. **补充说明超 200 字返回的是 100001（DTO 层），不是 80003（业务去重）**。
   `@Size` 在进业务之前就拦下了。写成期望 80003 就会红，
   而「先入为先」不是「先业务后参数」。
2. **CDP 里不能用首页两个流验拉黑**：它们只取第一页 20 条且按时间倒序，
   固定搭子的笔记比本组前几段刚造的数据旧，**根本不在第一页**。
   拿第一页断言会变成「恒真」—— 看着绿，其实钉不住任何东西。
   契约层按 noteId 精确断言（服务端、确定性），CDP 层只验界面
   （作者主页笔记数 + 详情页拿不到）。

### 举报去重是**永久**的，没有撤回接口

所以第二次跑 `ui-follow` 的举报提交必然拿到 80003。这是产品承诺的行为，
因此那条断言写的是「**有明确反馈**」（首次成功关弹窗 / 重复举报给出提示），
而不是「弹窗一定关闭」。这与「用 `||` 掩盖不稳定」不同：两个分支
各有自己的提示文案，都是被保证的行为。

### 测试基建：清理必须放进 `finally`

`ui-follow` 这一段崩在清理之前，拉黑关系留在库里，
**下一轮「关注流出现测试笔记」会永远超时** —— 症状与新代码毫无关系，
看起来像是拉黑功能把关注流弄坏了。改成 `finallyCleanup` 数组、
由 `finally` 统一执行后才稳定。这与 P15 记的 `ui-notification` 是同一个坑。

### P19 视频：上传 + 原文件播放（本 commit）

契约 **543 条**（529 + 14，19 段），CDP **462 条**（453 + 9，ui-note）。

**本轮刻意只做「上传 + 存原文件 + 播放器」，不做转码。** 这是明确的边界而不是省事：
转码要引入 ffmpeg 依赖、CPU 开销、以及「转码失败怎么办」的一整套状态机，
属于要单独立项的工程。反过来，「能上传能播」这件事本身有价值 ——
之前 `note.video_url` 存了但**详情页根本没有 video 标签**，等于这个字段是死的。

- 新增 `VideoStorage` 接口 + `LocalVideoStorage`（默认实现）。**刻意不与
  `ImageStorage` 合用**：两者约束完全不同（图片 10MB、每篇 9 张；
  视频 200MB、每篇 1 个），共用就得在每个方法里问「这次是图还是视频」。
- `POST /api/note/video`：multipart，**只放行 mp4 / webm**。
  限流 `10/min`（比图片的 30/min 严得多 —— 一个视频就是几十上百 MB）。
- `application.yml` 的 `multipart.max-file-size` 提到 200MB。调大它**不会**让图片
  突破 10MB，因为那是 `LocalImageStorage` 里另一道代码校验。
- 安全模型与图片完全一致：文件名一律 UUID、扩展名**按 content-type 反查**
  （绝不使用用户提供的原始名，否则 `../../etc/cron.d/evil` 能路径穿越）、
  拼完路径再 `startsWith(dir)` 确认一次、按日期分目录。
- 前端：发布页「发视频」是一个**切换模式**，不是同一个 input 里混选 ——
  一篇笔记要么图文要么视频（`note` 表只有 `cover` 与 `video_url` 两个位置），
  混着选会让用户传了 3 张图再选个视频、最后只生效一半。
  详情页 `<video controls preload="metadata" playsinline>`，
  `preload=metadata` 而不是 `auto`（一进页面就下上百 MB 不可接受），
  `controls` 必须留（移动端自动播会被拦，且有声自动播很烦人）。

## 四个刻意的取舍

1. **mov / avi 一律拒绝**（100001）：这两种浏览器不能直接播，放行它们等于
   「传完看到黑屏加一个下载按钮」，比明确拒绝更糟。前端在选文件时就提示转格式。
2. **不校验魔数**：只按 content-type 白名单。要做魔数校验得引入 `FileTypeDetector`
   之类的依赖，而现在这条链路的价值是「能上传能播」，不是防伪。
3. **不做封面抽取**：视频笔记的 `cover` 可以为空，详情页的播放器没有 poster。
   抽帧要 ffmpeg，属于转码那一档。
4. **删笔记时不删视频文件**：与图片一致（图片文件本体也留在 `uploads/`）。
   文件残留只是浪费一点磁盘，不该让删除接口失败。

## 两条测试上的自坑

1. **契约里我自己写的 `up()` 返回解析后的 body，我却按 `{ json: x }` 解构** ——
   断言报的是「code=undefined」，与「上传失败」毫无关系。
2. **未登录返回的是 HTTP 200 + body code 10005**，不是 401。断言按 401 写会红，
   而红的原因（约定记错）与视频功能无关。

CDP 那边还踩了一次：`exists`/`text`/`click` 三个 helper 在 `ui-note.mjs` 里
**本来不存在**（我从 `ui-interaction` 记混了），第一次跑是 `exists is not defined`。
补的时候又用了字符串拼接而不是本项目惯用的模板字符串，
结果报出 `t is not defined` —— 那个 `t` 是节点侧变量，压根不该出现在浏览器里。
**helper 要照抄同项目里已经跑通的那个文件，别凭印象写。**

- **prod 真调用已过**（走 nginx 18080）：3MB mp4 上传 `code=0` → 发布 type=2 →
  详情 `videoUrl` 一致 → 静态 GET 200/`video/mp4`、字节数与上传相同 →
  mov 拒 100001 → 删笔记 0。12MB 那一档在 dev 验过（**旧 10MB 配置必然炸，
  这是唯一必须真传大文件才能验的点**）。prod 探针账号按 8.4 的模式手删干净。

- **`multipart.max-file-size` 提到 200MB 是有代价的**：容器层兜底值一放宽，
  单请求就能占 200MB 内存。限流 `10/min` 是唯一防线，别为了「少传几次」调大它。

### P20 运营管理后台（本 commit）

契约 **591 条**（543 + 48，20.1 段），CDP **485 条**（462 + 23，新增 `ui-admin`）。

**它填的不是一个假想需求，而是一处已经悬了很久的空洞**：P18 的举报
「只记录、不自动处置」，`report` 表里连 `status` / `handle_note` 列都建好了，
却**没有任何运营接口** —— 举报进去就没人管了。顺带堵上 P3 遗留的
「草稿（status=0）只有管理端能造」缺口，并第一次有了账号级处置能力。

| 接口 | 说明 |
|---|---|
| `GET /api/admin/report/list?status=&targetType=` | 举报列表，**带被举报内容摘要 + 举报人** |
| `GET /api/admin/report/pending-count` | 待处理数（红点） |
| `POST /api/admin/report/{id}/handle` | body `{action, handleNote}`，见下 |
| `GET /api/admin/user/list?keyword=&status=` | 用户列表，带笔记数与**被举报次数** |
| `PUT /api/admin/user/{id}/status` | body `{status:0\|1}` 禁用/恢复 |
| `GET /api/admin/note/list?keyword=&status=&type=` | 笔记列表，**不过滤状态** |
| `PUT /api/admin/note/{id}/status` | body `{status:1\|2}` 强制下架/恢复 |

处置动作：`1` 驳回（`status=2`）、`2` 下架笔记、`3` 删除笔记、`4` 禁用作者
（这四个都把举报标成 `status=1` 已受理）。

### 三个设计决定，每一个都有代价

**① 鉴权按「路径前缀」而不是注解。**
`AdminInterceptor` 拦整个 `/api/admin/**`。做成 `@RequireAdmin` 注解的话，
新接口漏加注解就是**静默越权** —— 没有任何人会注意到；而漏掉前缀是一整条前缀都漏，
测试立刻炸。路径前缀是「默认全保护」，注解是「默认全保护，但要记得手动上锁」。

**② role 刻意不写进 JWT，每次查库。**
token 里带 role 看起来省事（少一次查询），但**撤权要等 token 过期才生效**。
而「把某个运营降级」几乎总是出事后要立刻做的事 —— 等两小时那段时间里
他照样能删数据。token 一旦签发就收不回来，这是 JWT 无状态设计的固有代价，
只能在**需要即时生效的字段**上退回查库。管理端流量低，这次 PK 查询可以忽略。

**③ 禁用账号 = 封号，且写操作当场失效。**
`AccountStatusInterceptor` 对所有 POST/PUT/PATCH/DELETE 再查一次 `status`。
登录本来就拒（`USER_DISABLED=10007`），但那不够：手上那个还没过期的 token
照样能发内容，从运营视角看就是「我明明禁了他，他怎么还在发」。
**读操作刻意不拦**：被禁用的人自己得能看到「我账号出什么事了」，
看不到只能去问客服；同时读是浏览热路径，不该为它加开销。
代价写在明面上：每次写多一条主键索引查找。

### 三个「不这么做会静默出错」的地方

- **处置动作不可重放**：已处理的举报再处置一律 `90003`。真正的风险不是重复点按钮，
  而是**两次不同的处置落在同一批内容上**（先下架再删除，用户看到的笔记就凭空消失）。
  `status` 由 `action` 推导而不让调用方直接传，就是为了不让运营自己想
  「下架之后这条举报该标成什么状态」。
- **运营改笔记状态必须复用作者那条路径**（`NoteService.forceChangeStatus`）。
  下架要撤搜索索引靠的是 afterCommit 发的 UNPUBLISH 事件；复制一遍 update + 事件代码的
  后果是「运营下架了但用户还能搜到」—— 那是一个**只有运营能发现**的静默不一致。
  删除同理（`deleteAsAdmin` 与 `delete` 共用 `deleteCascade`）。
- **举报对象可能已经不存在**（作者自己删了 / 被上一条处置删了）。
  列表里这时 `targetExists=false` 并提示「建议直接驳回」，**不报「处理失败」**。
  顺带一条产品事实：**举报没有撤回接口**，所以目标被删之后举报就成了孤儿行，
  测试数据清理必须带上 `report` 表（见第 5 节）。

### 错误码分段：9xxxx 是「只有运营能触发」

`8xxxx` 是**用户能触发**的动作（我举报了 / 我拉黑了），`9xxxx` 是**只有运营能触发**的。
分段之后日志与网关能按前缀分开统计 —— 用户侧举报激增和运营侧越权尝试
是完全不同的两件事，混在一个段位里看不出区别。

`FORBIDDEN_NOT_ADMIN(90001)` 刻意**不复用** `10005`（未登录）：两者要分开告警。
未登录是流量问题，一片 `10005` 说明有人在撞；**已登录却不是管理员**说明有账号
被错误提权，那是**安全事件**。

### 三个「不能禁」与两条默认值

`90004` 禁自己（把自己关在门外且无人能解）、`90005` 禁另一个管理员
（否则一个运营能把自己这条线的同事全干掉）。
运营笔记状态**只认 1/2 不认 0**：草稿是作者自己的中间态，
运营把别人的笔记按回草稿会让「这篇笔记消失了但没人下架过」成为可能。

### 测试基建

- **管理员 fixture 是常驻的**：`xk_ui_admin` / `xk_ui_admin2`，口令 `Xk@2026peer`。
  契约与 CDP 都**不新建管理员**（role 只能从库里改，而这两层都不该动数据库），
  而是各自**第一条断言就检查 fixture 还在** —— fixture 没了会立刻报出来，
  而不是让后面几十条集体假红成「鉴权坏了」。
- `ui-admin.mjs` 第 ⑦ 步会把 `xiaoku_demo` 禁用，**恢复必须排在 finally 的最前**。
  不恢复的话后面 ui-search / ui-follow 全都登不进去，而症状看起来与它们毫无关系
  —— 与 P15 记的「清理不在 finally 里」是同一个坑。
- `switchIdentity` 换 token 前必须先 `goto` 到应用域名：会话初始停在 `about:blank`，
  那是**不透明源**，读 localStorage 直接 `SecurityError`（首次跑就撞上）。
- 契约那段踩了三个自坑，都写进注释了：① `uploadImage` 返回 `{status,json,text}`、
  URL 在 `json.data.url` —— 直接把返回值塞进 `imageUrls` 会让发布返 `100001`；
  ② 同一个坑在 P19 的 `up()` 上已经踩过一次，**同类助手的返回形态不一致**；
  ③ 本段只注册 2 个账号（register 10/min/IP，再多注册会把其中一个打成 `100005`
  → 登录拿不到 token → `Bearer undefined` → 后续全返 `10006`「凭证无效」，
  看起来像「鉴权坏了」）；④ 最后一条断言原本写成「恢复后能重新登录」，
  而跑到文件末尾时 login 的 60/min/IP 桶已经见底 → 改成用**手里那个已被禁用过的
  token** 验证恢复，这也更准确：恢复要对同一会话立刻生效。

### 已知取舍

- **没有分页 UI**：三张表都取 `size=50` 一次，没有「加载更多」。
- **没有操作审计**：谁在什么时候处置了什么，只体现在 `report.handle_note` 的自由文本里。
  真实系统需要一张独立的 `admin_operation_log`。
- **`report_count` 是关联统计而不是冗余列**：user/note 列表里都带它。
  真要提速可以加异步刷新的列，但那会引入「刷列失败导致运营按旧数据处置」的坏情况。
- **前端 role 判断只是界面提示**：「我的」页的运营入口按 `role === 1` 渲染，
  但改 localStorage 就能让这一行出现。真权限在 `AdminInterceptor`，
  所以 `AdminView` 对 `90001` 的处理是**正常分支而不是兜底**（它会把用户退回「我的」）。

### P21 手测修复：通知撤回 + 举报入口 + 作者主页（本 commit）

契约 **618 条**（591 + 27，21 段），CDP **517 条**（485 + 32：layout 125→139
新增作者主页 +14、note 108→123 新增两处举报 +15、follow 43→46 新增「⋯」入口 +3）。

本轮**没有新功能**，全是 2026-10-08 手测暴露出来的四类问题。手测的价值
不在于「发现新 bug」，而在于它暴露了**测试本身的覆盖空洞** —— 后三类
都是「测试从没量过这个地方」。

#### ① 通知与实际互动不一致（数据层缺陷，不是 UI 问题）

**现象**：用户已取消点赞 / 评论已被删除，但通知中心的通知还在，点进去是
「笔记不存在」或「内容不存在」。

**根因**：P15 写通知时是**单向**的 —— 只在互动发生时 INSERT，没有任何
撤回路径。`uk_notify_once` 保证同一 `(receiver, actor, type, target)` 只有
一行，于是「点赞→取消点赞」留下的那行通知**永久**指向一个已不存在的
关系行。通知与互动数据的一致性从 P15 起就是断的，只是没人去核对过。

**修法**：`NotificationService` 加三个撤回方法，一一对应四类撤回时机：

| 方法 | 时机 | 撤回范围 |
|---|---|---|
| `retract(receiverId, actorId, type, targetId)` | 取消点赞 / 取消评论赞 | 精确那一条 |
| `retractByTarget(type, targetId)` | 删评论 | 该评论收到的一切通知 |
| `retractByNoteId(noteId)` | 删笔记 | 这篇笔记收到的一切通知 |

全部走 **afterCommit + try/catch 吞异常**，与「写通知」同一套约定 ——
通知写失败不该让点赞回滚，撤回失败同理。

⚠️ **`COMMENT` 是聚合通知，不能按 commentId 撤**：它在收到评论时是一条，
`target_id` 存的是**被评论的笔记**（一篇文章被评论 20 次也只有一行）。所以
删评论时只能撤「该评论者在**这篇笔记**下的**最后一条**评论」—— 判断依据是
`commentService.countByNoteAndUser(noteId, userId) == 1`。少了这个判断，
删掉 20 条评论中的第 1 条就会把剩下 19 条的聚合通知一起撤掉。

#### ② 举报入口只有作者主页有（覆盖空洞）

用户问「笔记和评论能不能举报」。查下来 `ReportSheet` 只挂在 `UserView.vue`
一个地方 —— 也就是说：**笔记详情页的「⋯」菜单里没有举报**，
**每条评论的「⋯」里也没有**。这是「功能做了，但只在最容易做的一处做了」。

修法：新 `MoreSheet.vue`（Vant ActionSheet 的薄封装，自定义 `xkKey` 做
data-test），三处入口 —— 作者主页顶栏、笔记详情顶栏、每条评论行。
`ReportSheet` + `useReportSheet` 提成共用（原来逻辑就在 `UserView` 里）。

⚠️ **Vant 4 的 ActionSheet 选项字段是 `name` 不是 `text`**，选回值走
`action.xkKey`（`name` 已被 Vant 占用）；浮层是 **teleport 到 body** 的，
懒渲染与否都影响 `await waitAndClick` 的可见性判定。

#### ③ 作者主页从未进过布局体检（一次改动抓出 2 处真溢出）

`ui-layout-audit` 一直量 6 个页面 × 2 视口，**`/user/:id` 不在里面**。
于是 2026-10-08 手测一打开作者主页就看到「拉黑/举报被压成两行」。

加进 `PAGE_LIST` 后**当场红了两条**，而且都不是玄学：

- `section.card` scrollW 241 / clientW 238（溢出 3px）
- `div.who` scrollW 217 / clientW 190（溢出 27px）

`div.who` 那条的**根因是设计而不是样式**：把「⋯」塞进头部那一行后，
那一行要同时装下 头像 62 + 昵称 + 用户名 + 关注钮 75 + ⋯ 40 + 两个 gap 28
= **205px**，而 240px 侧栏减去内边距只剩 **190px 可用**。

修法两条，**第一条是「⋯」根本不属于那一行**：

1. **「⋯」移到顶栏**。小红书的三个点也在页面右上角（9ok.com / 3DM 的
   操作说明都是「点右上角三个点」），不在头像旁边。移走之后那一行回到
   188px，装得下。
2. **桌面侧栏 240px → 300px**，与 `ProfileView` 对齐。P13 修过**同一处**
   缺陷（`@xiaoku_demo` 溢出压掉「编辑」按钮），当时把 `ProfileView`
   加宽了却没看 `UserView` —— 同一套组件模式、元素还更多。

**教训**：「加一条断言」比事后修三个 bug 便宜得多，而**加之前先想清楚
「这个页面为什么当初没被量」** —— 作者主页漏掉的原因和 P13 那次一样：
fixture 用的是 `xiaoku_demo`（11 字符），而手测用的 `xk_ui_follow`
（13 字符）恰好会溢出，短的那个永远测不出来。

#### ④ 无封面笔记的媒体块高度是 0（`aspect-ratio: 3/4` 的隐藏前提）

`NoteDetailView` 的图框是 `aspect-ratio: var(--r, 3/4)`。**没有图片时
`--r` 没被设置**，回退 3/4，于是 `.col-media` 渲染出一个**正比于宽度的高
盒子**——里面是空的。左下角挂个吉祥物看着像占位图，实际是拉高了一整块。

`HomeView` 也有同一个错：给无封面笔记回退到吉祥物时，顺手把**吉祥物的
宽高比**写进了 `--r`，于是 1080×1440 的吉祥物被当成 3/4 的图框裁切。

修法：`:has-media` 才渲染 `.col-media`（没有图就没有这个列），
`--r` 只在真的有图时才写。两处都在 ui-note / ui-layout 里有断言。

#### ⑤ 编辑笔记也必须带图（补后门）

P11 只给 `publish` 加了「图文必带图」（`validatePublishParams(dto, true)`），
**编辑是 `false`** —— 于是「发的时候干净、编辑时塞进去」这个后门一直开着，
正是 P15 审核段那条注释里点名担心的形状。改成 update 也传 `true`。

⚠️ **这会打脸已有的无图笔记**：`xk_ui_follow` 名下 5 篇 P6 时代的笔记
`cover IS NULL`，编辑它们时必须同时传新图，否则 `100001`。这 5 篇是
CDP 的常驻素材，**补封面时要用 `textCard.ts` 的 `brandCoverBlob` 生成
1080×1440 封面，并且带上原 title/content**（P10 起编辑是全量覆盖）。

### P21 测试基建：一个残留拉黑让**三个组同时变红**

`ui-follow` / `ui-search` / `ui-notification` 三组在一次全量连跑里同时
失败，且**每组的报错都指向自己的功能**（超时/20001/元素缺失），没有一条
提到拉黑。清掉 `user_block` 里的一条残留后**三组全绿**。

那条残留是手测时点过「拉黑」留下的。危害在于：

- `user_block` **双向生效**（`selectHiddenUserIds` 用 `UNION`），
  拉黑之后被拉黑者的笔记对**所有人**不可见 → 关注流空、搜不到、
  作者主页笔记列表空。三组各自的症状完全不同。
- **`finallyCleanup` 救不了它**：解拉黑虽然登记在 `finally` 里，但
  `ui-follow` 在**拉黑之前**要断言「拉黑前能看到 TA 的笔记」（这是 P18
  加的前置断言）—— 而崩掉时那条断言已经跑过，清理正常执行了。
  真正的原因是**手测**点的那一次，与脚本无关。

**判据**：三个以上不相关组同时变红、而每组症状都指向自己的功能时，
**先查全局状态**（`user_block` / `user.status` / `note.status`），
不要逐个组去调断言。这是 P15 记的「通知跨轮累积」的同源问题：
**自造用例不能假设库是干净的**。

### P21 已知取舍

- **撤回只在服务端做，前端不做兜底**：`NotificationBell` 拿到的列表可能
  含极短暂的「通知还在、但目标已删」窗口（撤回是 afterCommit 的）。
  要彻底消掉得在 VO 里带 `targetExists` 并在读时过滤，代价是每条通知
  多一次存在性判断。
- **`COMMENT` 聚合通知的撤回是「删到最后一条才撤」**：用户删掉自己在
  某篇笔记下的唯一一条评论时通知消失；删到还剩别的评论时通知保留。
  「我删了评论但通知还在」在「别人还评论过」的情况下是**正确**的。
- **作者主页的「⋯」在 `<1024px` 时仍可见**（顶栏），但作者主页本身
  移动端只有一个窄栏 —— 小红书在移动端作者主页也是把更多操作收进右上角，
  这条是对齐的，不是妥协。

### P22 私信（本 commit）

契约 **620 条**（618 + 2，22 段），CDP **537 条**（517 + 20，新增 `ui-message`）。

**为什么现在做私信**：P0~P21 有内容有关系、有话题、有 @、有举报有黑名单，
但**没有「人和人」这一层** —— 整个产品偏内容广场而不是社交站。私信是关系链
的最后一环，补上之后才谈得上「社交产品」。

#### 三个范围决定，都是**取舍**而不是「还没做」

1. **只做 1 对 1，不做群聊。** 群聊要多一张成员表，而小红书自己也很少用 ——
   「有但没人用」的功能会把每个页面都撑复杂。群聊是之后在**同一个会话模型**
   上加一层（`message_session` 的两列换成成员表）。
2. **投递用轮询（15s / 5s），不用 WebSocket。** 零新依赖、可上线、能验收，
   代价是消息最多晚 15s 出现。小红书客户端本来就是长连接，网页版用轮询是常规做法。
   接口层不需要为这个选择做任何让步 —— 接 WebSocket 只改投递这一层，业务不动。
3. **不做「撤回」与「编辑已发送的消息」。** 两者都要额外状态机
   （撤回要记谁撤的、编辑要保留历史），而 `message` 表刻意**没有 `update_time`** ——
   消息是不可变的事实。

#### 两个关键设计

**① 会话用「较小ID + 较大ID」规范化存储，而不是「发起方 + 接收方」。**

A 给 B 发消息与 B 给 A 发消息**必须落在同一行会话**。若存「发起方+接收方」，
`uk_session_pair (user_id, peer_id)` 会因为方向不同而全部放行 ——
「先查再插」在两人同时首次发消息时，两个事务都能查到「不存在」，各自插一行
（与 `topic` 的 `uk_topic_name` 同一个道理）。规范化之后 `(min,max)` 有序，
`(min,max)` 与 `(max,min)` 在**物理上**就是同一行，唯一索引才真正当裁判。

写入侧是 `insertIgnore` + 冲突后重查，而不是先查再插 —— 竞态收进 SQL 内部。

**② 未读数冗余在会话行上（`unread_low` / `unread_high`），不做实时 COUNT。**

会话列表是全站最常被打开的页面，实时聚合的代价与消息总量成正比。
漂移方向是**安全的**：只会多不会少（读消息失败时不清零，下次进会话页会再减一次），
不会出现「有未读却显示已读」。读的时候用**绝对值 0** 而不是「减掉本页条数」——
重复执行会减成负数，而 `GREATEST(0, x)` 只是把错误藏起来
（与 P8 `NoteCounterFlushJob` 的「绝对值覆盖」同一思路）。

#### 拉黑互禁：错误码刻意**不区分是谁拉黑了谁**

`user_block` 是双向生效的（P18），所以发私信前查「我们之间有没有任何一条拉黑关系」。
返回的 `50004` message 是「消息发送失败」而**不是**「你已被对方拉黑」——
P18 已经定过这个原则：把对方的操作暴露出去会把普通屏蔽变成社交对抗。

⚠️ 但**「消息发不出去」这个结果无法隐藏**（不发错误码前端会以为发送成功）。
这是整个设计里唯一没法完全藏住的地方，代价限定在「知道对方在屏蔽我」，
换不来的是「能绕过屏蔽继续发消息」。同样的理由让 `50005`（会话不存在）与
被拉黑**刻意同码** —— 告诉对方「会话不存在」等于告诉他「你被屏蔽了」。

#### 三个自测时踩到、且症状离真因很远的坑

1. **`waitFor('!document.querySelector(\'[data-test=x-loading]\')')` 会**瞬间**通过**。**
   组件还没挂载时那个元素就不存在，条件已经为真 —— 于是「等加载完成」根本没等，
   紧接着的断言全在空页面上跑。正确写法是等**终态元素出现**：
   `document.querySelector('[data-test=row], [data-test=empty]')`。
   （与 P12-C 给 `auditPage` 补的终态等待是同一类问题，但方向相反。）
2. **`token.ts` 的 `accessToken` 是模块级 ref，模块加载时读一次就固定了。**
   应用已启动后再改 localStorage，**内存里那份不变**，axios 仍带旧身份的 token
   发请求 —— 表现是「换了身份但列表还是空的」。换身份必须走一次**完整导航**
   让应用重新启动；`location.reload()` 塞在 evaluate 里会销毁执行上下文，
   与紧跟的 goto 打架（实测落在空列表上）。
   清 localStorage 同理：不重新导航就**不算登出**。
3. **MySQL 的中文输出在 PowerShell 里显示成 `?`，会被误判成「数据写坏了」。**
   验证要用 ASCII 谓词：`CHAR_LENGTH(COLUMN_COMMENT)` / `REGEXP '[^\\x00-\\x7F]'` /
   `LIKE '%?%'`（全 0 才是好）。灌 DDL 也有三档：
   `Get-Content -Raw | mysql` → 中文全变 `?`；
   `cmd /c "type f.sql | mysql"` → 按控制台 OEM 代码页转换，一半字坏掉；
   **只有 `node` 的 `spawnSync({input})` 能让字节原样送达**。
   读文件同理：`Get-Content` 默认按 ANSI 解 UTF-8，中文注释会变成乱码并**破坏 SQL 字符串**。

#### 其他刻意不做

- **不做「谁看过我的私信」**、不做已读回执的逐条时间戳（只做会话级已读）。
- **不做聊天记录分页 UI**：后端 `page` 参数在，但前端只取最近 50 条。
  真要加得先定「往上翻还是往下翻」的产品口径。
- **私信没有撤回**（见上）。
- **`message` 上没有 `update_time`**，所以编辑消息需要改表。

### P22 已知缺口

- **测试会留下消息**：`ui-message` 每轮在 `xk_ui_smoke ↔ xk_ui_follow` 之间
  造 2~3 条消息，而**私信没有删除接口**（P22 刻意不做撤回）。所以
  `message` 表会随轮次累积，断言必须用**相对增量**而不是绝对值。
  要清就按第 5 节的模式按前缀删（消息正文以 `P22` 开头）。
- **两个 fixture 之间现在有常驻会话**：`xk_ui_smoke` 的会话列表不再为空，
  而 `ui-message` 里「空列表」的分支只在第一次跑时成立。
- **气泡里的长文本会换行**（`overflow-wrap: anywhere` + `pre-wrap`），
  但没做「长消息折叠」—— 那要额外的高度测量，而 P12 那套 `--media-h`
  机制已经被删掉了（理由见 P12 段：它是为了「评论进右栏」而存在的）。

### P23 推荐：可解释的热度分（本 commit）

契约 **621 条**（620 + 1，17.5 段改写），CDP **537 条**（不变 —— 纯后端）。

**先量后写**：立项时的假设是「物化 `hot_score` 列能让排序进索引、消掉 filesort」。
动手前先量了真数据，**假设被推翻**：

```
现状前 20 条：已关注 = 20/20（全是我关注的人）
年龄区间：216h ~ 288h（全是 9~12 天前的内容）
信号强度：80% 的笔记互动为 0，中位数 0，最大 6
零关注新账号看到的发现流：18/20 恰好都是 216.1h（那批种子数据）
```

**性能论证不成立**：299 篇笔记、discover p95 ≈ 80ms（远低于项目自己的
600ms 预算）。物化列要付出「异步刷列 + 漂移」的**确定成本**，而时间衰减项
会随时间变，光靠 `NoteCounterFlushJob` 那个计数刷新的钩子**刷不干净**，
还得再加一个周期性 decay job。换一个当下量不出来的收益 —— 不做。

**真正的毛病是排序质量**：80% 内容零互动时，`互动 DESC, 时间 DESC` 实际等于
「按互动分层、层内按时间」，于是 9 天前的内容霸榜，新内容全被埋。

#### 公式：`(1 + 3·赞 + 4·藏 + 5·评) / (发布天数 + 7) ^ 0.5`

每个常数都是对着真数据量出来的：

- **常数 1 的基线** —— 让零互动内容也有正分，否则新内容永远出不来。
- **权重 3/4/5** —— 评论比点赞贵（要打字、还产生通知），收藏比点赞贵
  （是「我要回来看」的信号）。权重差距刻意不大：库里最大互动量只有 6，
  再放大只会退化成「谁赞多谁赢」。
- **天数 + 7** —— 一周内的年龄差异几乎不影响排序（除数 7→14 只差 1.41 倍，
  而互动 0→6 差 19 倍）。
- **指数 0.5** —— 开方，见下。

#### ⚠️ 照抄 Hacker News 会**整个翻转排序**（实测）

HN 的 `(1+3L+4C+5Cm)/(age_hours+2)^1.5` 在本项目是错的，因为**两个信号的量级
完全不匹配**：互动量只有 0~6（分子 1~30），年龄跨度却是 0~216 小时
（除数 2.9~3240）。**衰减比互动强两个数量级**，于是「5 小时前发的零互动测试
笔记」以 0.054 分压过「9 天前的 6 互动内容」（0.006 分）—— 前 8 名**全是**
刚发的零互动内容，排序等于失效。把指数降到 0.5、年龄单位从小时改成天才配平。

**教训**：照抄一个「公认合理」的公式之前，先拿自己的数据跑一遍。
公式的形状取决于**两个信号的量级比**，而量级比是每个项目自己的性质。

#### 一条契约断言被换掉（换的是它的**语义**，不是它的强度）

P14 钉的是「同一档内互动量非递增」。P23 起第二排序键不是互动量了，这条
**必然**会红 —— 第一次跑就红在 `...,3,3,4,2,...`（互动从 3 涨到 4）。

新的断言是**在测试侧把公式重算一遍**再比对：只断言「互动量非递增」会漏掉
常数被改动的情况（公式与断言脱钩），而重算等于把
`(1+3赞+4藏+5评)/(天数+7)^0.5` 这个形状钉死 —— 谁改了 `FeedMapper` 里的常数
而没同步这里，这条立刻红。

另加一条**反向断言**：互动量本身允许非递增。若它红，说明数据里互动量恰好
单调，用例失去区分力（**不是代码有问题**）—— 这类「用例自己失去区分力」
的判断必须写出来，否则下一个人会当成回归去查。

#### ⚠️ 本项目 SQL 里**不能写 `--` 注释**（新坑，报错极具误导性）

在 `@Select` 的文本块里加了三行 `-- P23 热度分：…` 注释，整个接口立刻返
`100999`，后端日志是：

```
Caused by: java.sql.SQLException: sql injection violation, dbType mysql,
            druid-version 1.2.28, comment not allow : SELECT n.*
```

**报错说的是「SQL 注入」，与真因（我写了注释）隔了整整一层**，
而症状只是「接口返 100999」。Druid 的 wall filter 默认拒绝带注释的 SQL。
本项目的 SQL 注释一律写在 Java 侧。

（顺带：Java 文本块不能写成 `""" + CONST + """` 来拼常量 ——
`"""` 之后必须紧跟换行，拼接会报「文本块开始定界符非法」。AGENTS 第 5 节
记过同类形状。）

### P23 已知缺口

- **没有用户画像**。真正的推荐要按「我常看什么」调整排序，现在只有
  「关注优先」这一个用户侧信号。数据量够（笔记数 &gt; 5000 或
  互动分布不再长尾）时才是下一步。
- **`user_follow.status` 是废弃列但仍被 `pageDiscover` 的 EXISTS 依赖**：
  P6 起关注/取关走物理删，这一列理论上该恒为 1 —— 现在库里 12 行确实都是 1，
  但哪天有个写入路径忘了维护它，排序会**静默**变成「已关注不优先」，
  而症状是「发现流里我关注的人不见了」。要么补写入、要么把条件去掉。
- **热度分是全局的，不随 viewer 变**。同一份 `hot_score` 对所有人生效，
  而它应该至少按「我关注的人的互动」加权。
## 8. prod 栈运维（2026-10-04 踩出来的，都是环境问题不是代码问题）

### 8.1 prod 后端镜像曾经落后三个阶段（已修）

**现象**：前端已带「发现」tab 部署到 `18080`，但 `GET /api/feed/discover` 返回
`100404 接口不存在`；`DELETE /api/note/{id}` 返回 `100002 方法不支持`
（而 `@DeleteMapping("/{id}")` 明明在代码里）。

**根因**：prod backend 镜像构建于 **2026-09-29**，而删除接口是 **09-30**（P11）
加的、发现流是 10-04（P14）加的 —— 也就是说**镜像比仓库落后 P11/P12/P14 三个阶段**。
前端一直在重建、后端一直没重建，这个组合是坏的。

**判据**（下次怀疑时先查这两条，别猜）：

```powershell
docker inspect xiaoku-backend:latest --format "{{.Created}}"     # 本地镜像构建时间
docker inspect xiaoku-prod-backend-1 --format "{{.Image}}"      # prod 容器用的镜像
git log -1 --format="%ad" --date=iso -S'DeleteMapping' -- backend/src/main/java/com/xiaoku/module/note/controller/NoteController.java
```

**教训**：改前端就只重建前端，这个习惯在「后端也有改动」时会静默留下
「新前端 + 旧后端」。**每次部署前先确认后端镜像日期晚于最后一次后端提交。**

### 8.2 本机构建后端镜像走不通的三道墙与绕法

`docker compose ... build backend` 在这台机上**当前跑不通**，三道墙依次是：

1. **Docker Desktop 守护进程级镜像源拉不动 blob**：
   `image-mirror.r2.daocloud.vip` 连续 3 次 `EOF`，清空 `REGISTRY_PREFIX`
   也无效（那是 compose 变量，镜像源在 daemon 侧）。
   **绕法**：`$env:DOCKER_BUILDKIT="0"` 用 classic builder —— 两个基础镜像
   （`maven:3.9.9-eclipse-temurin-17`、`eclipse-temurin:17-jre`）本地都有缓存，
   classic builder 不回源校验 tag。
2. **容器内 Maven 连不上 Maven Central**：`UnresolvableModelException`。
   **绕法**：先在主机上 `.\mvnw.cmd -DskipTests package`（**不要加 `-o`**：
   本地 `~/.m2` 从没下过 surefire 的依赖，离线模式必然
   `PluginResolutionException`），再用一份**临时** Dockerfile 只复刻
   `backend/Dockerfile` 的运行时阶段，把 `target/xiaoku-backend.jar` 拷进去。
3. **`archive.ubuntu.com` 502**（运行时阶段 `apt-get install curl`）：
   **绕法**：临时 Dockerfile 里先 `sed` 把 apt 源换成清华镜像。

配套的两处临时改动，用完必须还原/删除：
- `.dockerignore` 里有 `target/`，要让 JAR 进构建上下文得临时放行
  （`target/*` + `!target/xiaoku-backend.jar`）
- 临时 Dockerfile 放 `backend/Dockerfile.localtemp`，**别提交**

⚠️ **还原 `.dockerignore` 别用 `Set-Content -Encoding UTF8`**：PowerShell 5.1 的
`UTF8` 会**写 BOM**，于是第一行变成 `\ufefftarget/`（BOM 不在行首，`.dockerignore`
的 `target/` 就匹配不到了），而 git diff 里只显示成 `-target/` / `+\ufefftarget/`
—— 看起来像「内容没变却有 diff」。直接 `git checkout -- backend/.dockerignore`
更快也更不容易出错。

**仓库里的 `backend/Dockerfile` 与 `.dockerignore` 一个字都没改** —— 上面三条
全是本机网络环境的问题，把镜像源写进仓库 Dockerfile 会污染所有人的构建。

### 8.5 只重建 backend 容器后 nginx 报 502（2026-10-08 踩过）

**现象**：`docker compose -f deploy/docker-compose.prod.yml up -d backend` 之后，
prod backend 容器 `health=healthy`、容器内 `curl /api/system/ping` 返回 `{"code":0}`，
但从宿主打 `http://127.0.0.1:18080/api/system/ping` 是 **502 Bad Gateway**。
此时如果按 8.1 的判据去查镜像日期，会发现镜像**确实是新的**（就是刚 build 的），
于是得出「镜像没问题、那一定是代码的问题」——**结论完全反了**。

**根因**：nginx 在**启动时**把 upstream 的主机名解析成 IP 写进配置。backend 容器
重建后 IP 变了（docker 每次 recreate 都可能重新分配），nginx 还拿着旧 IP 去连，
连不上就是 502。**nginx 容器本身完全健康**，所以 `docker ps` 全绿、
`docker inspect xiaoku-prod-frontend-1` 也一切正常。

**修法**：`docker restart xiaoku-prod-frontend-1` 让它重新解析。

**判据（一句话）**：`502` + `后端容器内 curl 正常` + `镜像日期是新的`
= nginx 缓存了旧 IP，不是后端问题，也**不是**镜像落后于代码。

⚠️ 这与 8.1 的现象**完全相反**（8.1 是镜像落后 + 接口 404/100002），两者都表现为
「prod 行为与仓库不一致」，所以先分清是 **502**（上游连不上 → 重启 nginx）
还是 **业务错误码**（接口存在但行为旧 → 查镜像日期）。
### 8.3 换 analyzer 必须删索引重建（prod 也踩了一次）

给 prod ES 装上 IK 插件后，我用旧后端发一篇「图书漂流」搜「图书漂流」→ **命中了**，
看起来 IK 生效了。**这是假阳性**：那次跑的是 9-29 的旧后端，索引/查询两端都是
`standard`，靠单字匹配碰巧命中；而 `xk_note` 的 mapping 当时仍是
`"analyzer": "standard"`。

**ES 永远不会升级已有索引的 mapping**（AGENTS 第 7 节 P10 段已记过一次，
这次在 prod 又踩了一次）。判据只有一条 —— 直接查：

```powershell
docker exec xiaoku-prod-elasticsearch-1 sh -c "curl -s 'localhost:9200/xk_note/_mapping?pretty'"
```

看到 `"analyzer": "standard"` 就是没生效。正确顺序：
**先装插件 → 删索引 → 调 `/api/search/reindex` 让新后端按注解重建**，
再验证。验证要用**双字词**（「图书漂流」这种）：单字词在 standard 下也能命中，
区分不出 IK 与不 IK。

### 8.4 prod 库里没有演示账号，探针账号要自己注册

`application-prod.yml` 的 `init-demo-data` 默认 **false**，所以 prod 没有
`xiaoku_demo`（`Xk@123456` 在 prod 登不进去，别再试）。要在 prod 验证就得注册
临时账号。**后端没有「删账号」接口**，探针账号会留在库里：

| 账号 | 用途 | 笔记 |
|---|---|---|
| `prod_iktl8t38` | 搜索对照（读者视角） | 无 |
| `prod_iktlbmxk` | IK 验证作者 | 已删 |
| `prod_iktmli1d` | IK 复验作者 | 已删 |

笔记都走 `DELETE /api/note/{id}` 清掉了，ES 索引 `xk_note` 现在 0 篇
（`docs.deleted` 计数会留着历史，属正常）。要彻底清账号得进 prod MySQL 手删。

**P17~P22 的探针账号都已手删干净**，当前 prod 库里只剩上表那两个历史遗留的
`prod_iktl*`（各 0 篇笔记）与 2 条演示举报。规律：
**每轮探针的编号前缀（`prod17%` / `prod20%` / `prod21%` / `prod22%`）跑完立刻删**，
用第 8.8 节那个「按前缀查 user 表 + 派生表物化」的一条语句即可 ——
prod 是给人看界面的，别攒一堆 `prod22amv24zx97` 这种账号。

**P22 的 prod 真调用已过 27 条**（走 nginx 18080）：规范化会话、未读 +1、
已读幂等、拉黑双向互禁与解黑恢复。prod 部署顺序按 8.2 / 8.5 / 8.6：
先灌 `message_session` + `message` 两张表（**只有 node 的 spawnSync 能让中文
COMMENT 字节原样送达**），再单独 build backend 镜像、重建 backend 容器、
**重启 nginx**（8.5：不重启会 502），最后前端 `--no-deps` 单独重建。

### 8.6 改后端时 `up -d --build frontend` 会**连带重建 backend** 而失败

**现象**：只改了前端，跑 `docker compose -f deploy/docker-compose.prod.yml
--env-file deploy/.env.prod up -d --build frontend`，结果 Maven 报错刷屏、
构建失败 —— 而这次**只碰了前端**。

**根因**：`frontend` 在 compose 里 `depends_on: backend`，`--build` 会把依赖图上
的**全部**服务一起重建，于是也去跑 backend 的 `mvn package` 阶段，撞上 8.2 的
墙②（容器内连不上 Maven Central）。**报错完全指向前端改动无关的东西。**

**修法**：只改前端时单独构建 + 只重建前端容器：

```powershell
docker build -t xiaoku-frontend:latest frontend
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod `
  up -d --no-deps --force-recreate frontend      # --no-deps 是关键
```

`--no-deps` 让 compose 不去碰 backend。这与 8.1 是同一条教训的另一半：
**「只重建前端」在有依赖关系的 compose 里做不到，得显式加 `--no-deps`。**

### 8.7 prod 验证别照抄 dev 的 DTO 字段名

第一次跑 prod 探针，「举报笔记」两条断言红成 `100001 举报原因不能为空`。
真因不是 prod 配错了，是**探针脚本把字段名写成了 `reason`（自由文本）**，
而 `ReportCreateDTO` 实际是 `reasonCode`（`@Min(1) @Max(6)` 的枚举）+
可选 `detail`。

`100001` 来自 DTO 层的 `@Min/@Max/@NotNull`，**不进业务层** —— 与 P18 记的
「补充说明超 200 字返回 100001 而不是 80003」是同一形状：**参数校验先于业务去重**。
所以「字段名写错」的报错也永远是 `100001`，不会告诉你是哪个字段。

**判据**：prod 探针报 `100001` 且 message 提到某个字段名时，先 `Read` 那个
DTO 确认字段名与约束，**不要**怀疑 prod 的数据或配置 —— dev 契约测试
之所以没暴露，是因为它用的是同一个 DTO（前端已经写对了）。

### 8.8 往 prod MySQL 灌清理 SQL：临时表**不跨连接存活**

第 5 节那套 `CREATE TEMPORARY TABLE _ct AS ...` + 后面十几条 `DELETE` 全靠它，
但那是**同一个连接内**执行的。往 `docker exec -i ... mysql` 灌脚本时踩了两个坑：

1. **`CREATE TEMPORARY TABLE` 之后的语句报 `Table '_p' doesn't exist`**：
   临时表是**连接级**的，`mysql` 客户端每条语句可能重开连接。
2. **把 `OR` 两侧各引用一次临时表报 1137 `Can't reopen table`**，
   而且**报错之前那几条 DELETE 已经执行完了**（半截清理）——
   别以为整段没生效。

**最省事的解法：临时表换成「按前缀直接查 user 表 + 派生表物化」**，一条语句搞定，
不依赖临时表存活：

```sql
DELETE FROM xiaoku_db.notification
  WHERE actor_id   IN (SELECT id FROM (SELECT id FROM xiaoku_db.user WHERE username LIKE 'prod21%') k)
     OR receiver_id IN (SELECT id FROM (SELECT id FROM xiaoku_db.user WHERE username LIKE 'prod21%') k);
DELETE FROM xiaoku_db.user WHERE username LIKE 'prod21%';
```

灌多行 SQL 时用 `Set-Content -Encoding Ascii` 落盘再
`Get-Content -Raw | docker exec -i ... mysql`（PowerShell 5.1 **不支持** `<` 重定向给
原生命令，会报 `RedirectionNotSupported`）。
