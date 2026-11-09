# AGENTS.md —�?本项目的操作前提与硬性规�?
给后续接手的人（�?AI 助手）看。这里只�?*不看就会踩坑**的东西；
设计意图和阶段规划在 `README.md`�?

## 0. 进度速查�?026-10-19�?

| | |
|---|---|
| 阶段 | **P0 �?P48 已完�?*（详见第 7 节各阶段小节�?|
| 测试 | 契约 **807** �?· CDP **803** 条，全部�?|
| prod | `18080`，跑的是 **P47 前后�?*（举报处置闭�?+ 搜索页相关用�?+ 私信�?TabBar 遮挡�?‑ **P48 尚未部署** |
| 重建 prod 的坑 | 见第 8 节：8.2 镜像构建三道�?/ 8.5 nginx 缓存�?IP / 8.6 `--no-deps` |
| 上一次部�?| P47（前后端一起）· prod 真调用：P47 搜索用户 **OK**、P46 全流程受限于现有 report 状态（接口已部署） |
| 待做 | P48 部署后给 prod 补真调用记录（部署顺序照 8.2 / 8.5 / 8.6，**存量库要 ALTER `note.video_qualities`**，prod ES 无关） |
| 重启�?| **�?`tools\dev-up.cmd`**（见 2.0 节，引擎没起它会自己拉起�?3s）�?手工清单留在 2.0 的折叠块里兜�?|

**最近几个阶段做了什�?*：P37 长视频实测（172MiB 端到�?43.5s，抓�?nginx 只允�?100m 的三层不一致）·
P38 用户中心（编辑资料独立成�?+ 笔记/收藏/赞过�?Tab + `GET /api/note/liked`）�?
P39 主页对齐（背景头�?+ 移动端两列瀑布，顺手修�?P23 断言的口径不一致）·
P40 布局收口（移动端首屏见笔�?+ 桌面只留一条顶�?+ SiteNav 当前页高亮）·
P41 手测修复（运营后台看不懂 + 编辑资料页按钮重叠）·
P42 运营能点进去看被举报的原文（后台新增 targetNoteId + 管理员只读视角）·
P43 桌面端页面顶栏降级（一�?CSS�?4 页受益）·
P44 隐私设置：私密账号（关注者可�?+ 四处查询过滤）�?
P45 评论举报定位到那条评论（GET /api/comment/{id} + ?comment= 定位高亮）�?
P46 举报处置闭环（通知类型 8 + 驳回必填理由）�?
P47 搜索页「相关用户�? 私信�?TabBar 遮挡修复（token 56�?8px）�?
P48 视频多码率（720p 主档 480p 共三档 Generation + 降级保 videoUrl 兼容）与 VideoPlayer.vue 自绘播放器（详情/沉浸两处接线，layouts 下隐藏原生 controls 及进度条 UI）·
---

## 1. 命名约定（不要随便改�?
| �?| 名称 | 说明 |
|---|---|---|
| 产品 / 社区�?| **毛球喵社 Fuzzball-Meow-Hub** | �?GitHub 仓库名逐词对应 |
| 吉祥物名 | **小哭�?Xiaoku** | 角色本身，类�?GitHub 之于 Octocat |

`xiaoku` 同时�?*吉祥物代�?*，不是平台名。因此以下标识符**刻意保持原样，不要改**�?
- Java �?`com.xiaoku`�?8 个源文件�?- `xiaoku_db`、`xiaoku-mysql` / `xiaoku-kafka` / `xiaoku-elasticsearch`、`xiaoku-net`
- 配置前缀 `xiaoku:`、JWT `issuer=xiaoku`
- `xiaoku-backend`（artifact / `spring.application.name` / 日志文件名）
- 类名 `XiaokuApplication`
- 演示账号 `xiaoku_demo`，其昵称是「小哭猫�?
改这些的收益只是"拼写看起来更统一"，代价是数据迁移 + 容器重建 + 全量回归�?**只有用户可见文案**（README、`index.html`、页面品牌、router 标题、`document.title`�?OpenAPI 标题、启动横幅、`pom.xml` description、配置注释头）才跟产品名走�?
因为演示账号昵称保持「小哭猫」，前端 CDP 测试里的 5 处昵称断言
**不需�?*跟着改名�?
---

## 2. 环境前提（这台机器上�?
```powershell
# JAVA_HOME 默认指向 JDK 8，直接跑 Maven 会报「无效的目标发行�? 17」�?# 任何 mvnw / mvn 命令前必须先覆盖�?$env:JAVA_HOME = "E:\JDK17\jdk-17.0.1"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
```

```powershell
# GitHub 推拉�?*先试直连，不通再带代�?*。git 不会自动用系统代�?# （PowerShell �?Invoke-WebRequest 会）�?# 2026-10-01 实测：代�?127.0.0.1:7897 端口在监听，但经它的 schannel TLS
# 握手直接失败（SSL/TLS connection failed），不带代理反而推成功�?—�?# 旧记录「直连必失败、push 要带代理」已过时。判断顺序：
git ls-remote --heads origin           # �?�?直接 git push origin main
# 不通才带代理：
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
```

⚠️ **代理记录已作废（2026-10-06�?*：上面那段说"经代�?TLS 握手失败、直连反而�?
在本�?*不再成立**�?0-05 推送连续失败（`Recv failure: Connection was reset`�?`Failed to connect to github.com port 443`），直连 ls-remote 也失败，带代理才推成功；
�?10-06 又出现直连成功的情况�?*结论：这个网络到 GitHub 的连通性会漂移**�?所以每次都按上面顺序实测判断，不要照抄结论�?
### 2.1 git 署名邮箱必须�?remote 域名对得上（2026-10-06 踩过�?
**GitHub 判定贡献归属看的是提交里记录�?author/committer 邮箱**�?跟「你在网站账号设置里绑的邮箱」是**两套互不相通的东西** —�?后�?GitHub 不会
主动拿去匹配历史提交。所以本地署名邮箱写错，代码照样推得上去、远�?SHA 照样对，
**但贡献图永远是空�?*，而且不会有任何报错�?
⚠️ **这个项目就中�?30 �?*：全局 `~/.gitconfig` 里是
`14971050+y3148y@user.noreply.gitee.com`�?*Gitee** 的隐匿邮箱，
`user.noreply.gitee.com`），�?remote �?`github.com/Y3148y/...`�?GitHub 完全不认�?gitee.com 这个隐匿邮箱域名，于�?09-27 �?10-05 �?30 个提交一天不落，**全部归属不到任何账号**�?已改�?`3148555328@qq.com`�?026-10-06），并用空提交推上去验证�?`api.github.com/repos/Y3148y/Fuzzball-Meow-Hub/commits/<sha>` 返回
`author.login = Y3148y` —�?归属确认成功�?
**为什么没早发�?*：noreply 邮箱**不含真实邮箱**，所以既不泄露隐私�?也不触发任何安全告警，看起来完全无害。而且这台机器�?`ai` /
`springai-demo` / `InterviewGuide` 三个仓库都用了同一个全局邮箱�?问题不止一个项目（InterviewGuide 那个还是别人的仓库）�?
**规矩**�?
1. **新建仓库后、第一�?commit 之前**就核对一遍：
   ```powershell
   git config --get user.email; git remote get-url origin
   # 邮箱域名�?remote 域名对不上（github.com �?gitee.com 邮箱之类）→ 先改
   git config user.email <该平台已验证的邮�?
   ```
2. **换平台用不同的隐匿邮�?*是正常需求（隐私考虑），�?*绝不能放在全局** —�?   全局是所有项目共用的，一个项目的身份会污染全部仓库。正确做法是
   **仓库�?*：`git config user.email <隐匿邮箱>` 只作用于当前仓库�?3. **不确定归属是否生效时，用公开 API 自己�?*，别�?推成功了"就当完事�?   ```powershell
   $c = Invoke-RestMethod "https://api.github.com/repos/<owner>/<repo>/commits/<sha>" -Headers @{ "User-Agent"="chk" }
   $c.author.login      # 有�?= 已归属；null = 没归�?   ```
4. 历史提交要一起归属回来只能改写历史（`git filter-repo`�? force-push�?   **代价是所�?SHA �?+ 所�?tag 失效要重�?*。仅为贡献图不值得�?   除非用户明确要求�?
其他固定前提�?
- MySQL 容器绑定 **`127.0.0.1:3309`**（只对回环开放，刻意不对局域网暴露�?- Redis 容器绑定 **`127.0.0.1:6379`**�?026-10-05 补进 dev compose，理由见下面那条�?- Elasticsearch `9250`、Kafka `9092`、后�?`8088`、前�?dev `5180`
- 仓库根目�?`.env` 提供 `MYSQL_ROOT_PASSWORD`�?*永不提交**�?

### 2.0 重启电脑后：**先跑一条命�?*

```powershell
D:\IDEAprojects\red-book\tools\dev-up.cmd          # 双击也行
D:\IDEAprojects\red-book\tools\dev-up.cmd -WithProd   # 顺带拉起 18080
D:\IDEAprojects\red-book\tools\dev-down.cmd        # 停（�?-WithContainers 连中间件一起停�?
```

它把下面那张手工清单**整个自动化了**：探 Docker 引擎（没起就自己拉起并轮询到就绪�?
�?中间件并�?`up -d` �?`up -d --wait` **阻塞�?mysql/redis 真正 healthy** �?
后端与前�?*并行**启动 �?轮询两个服务就绪 �?打印就绪报告与各阶段耗时�?

实测�?026-10-19�?*三条路径都跑�?*）：

| 场景 | 耗时 | 说明 |
|---|---|---|
| **引擎没起**（最坏情况） | **33s** | 脚本自己拉起 Docker Desktop，引擎就绪占 14s |
| 引擎在、后端前端没�?| **29.9s** | 后端 Spring Boot 启动�?17s |
| 全都已在跑（重复执行�?| **15.2s** | 全部 skip，幂�?|

原本要手动开 4~5 个窗口、轮�?`docker ps`、盯后端起来�?

�?**恢复出来的环境能直接干活**（同一次冷启动后立刻验的）�?
契约 `726/726`、`ui:smoke 43/43` 全绿�?
⚠️ **引擎没起那条路径是专门验证过�?*：把 Docker Desktop 整个关掉
（`DockerCli.exe -Shutdown`）再�?`dev-up`，脚本能自己把它拉起来并等到
就绪—�?*这正是重启后的真实场�?*（`AutoStart = false`），所以别再假�?
「引擎肯定是开着的」�?

日志落在 `logs/dev-backend.out.log` / `dev-frontend.out.log`（`logs/` 已被 gitignore）：

```powershell
Get-Content logs\dev-backend.out.log -Tail 50 -Wait
```

⚠️ 三条**�?AGENTS 里的血泪教训直接搬进脚�?*的（脚本层面堵死，别再手踩）�?
�?`.env` 缺失 / `MYSQL_ROOT_PASSWORD` 没设�?*提前失败并说明白**，而不是让�?
对着 `Access denied for user 'root'@'172.20.0.1'` 猜；�?后端超时�?*自动打印
日志最�?30 �?*并按「先 `docker ps` �?redis �?�?`echo $env:XK_MYSQL_PASSWORD`�?
的顺序提示；�?`dev-down` **按端口杀进程而不是按 PID 文件** —�?PID 文件记的�?
`mvnw.cmd` / `npm.cmd` 启动器，真正占着 8088 的是�?fork 出来的孙进程�?
杀启动器只会让孙进程变孤儿继续占端口，于是下次 `dev-up` 看到「端口已监听�?
就跳过，你对着一�?*旧进�?*测半天�?

⚠️ **脚本只驱�?Docker 与本机进程，不碰 prod 数据�?文件**�?
`-WithProd` 才碰 prod 栈，且默认不带（这台�?16GB，全开只剩 2.9GB�?
P21 记过内存不足导致�?flake）�?

⚠️ 输出**重定向到文件时是 GBK**（PowerShell 5.1 用控制台代码页写输出）�?
在控制台里双击运行显示正常；要读落盘文件得用 GBK 解码�?
`Read` 工具�?UTF-8 读会满屏乱码 —�?**那不是脚本出�?*�?

<details>
<summary>手工清单（脚本挂了时的兜底，也可以照着理解依赖顺序�?/summary>

⚠️ 下面这张表是为「重启后把所有运行时状态拉回来」写的。上面第 2 节记�?
是各零件的端口与前提，但**没有把它们串成顺�?* —�?2026-10-11 因为没有这张表，
Docker Desktop 整个停掉时绕了一圈才定位�?redis�?*照下面这个顺序做**�?

```powershell
# �?Docker Desktop 必须**手动启动**（不自启�?
#    C:\Program Files\Docker\Docker\Docker Desktop.exe
#    引擎没起来时任何 docker 命令都报�?
#      cannot connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
#    起来之后先探测一次，别假设：
docker version --format '{{.Server.Version}}'

# �?dev 中间件�?*redis 不能�?* —�?漏了后端起不来，
#    而报错藏�?spring-boot-maven-plugin 那句 'Process terminated with exit code: 1'
#    后面，真因在日志上方几百行的 Connection refused: 127.0.0.1:6379
cd D:\IDEAprojects\red-book
docker compose up -d redis mysql kafka elasticsearch
docker ps --filter "name=xiaoku-"     # 四个�?Up(healthy) 才继�?

# �?后端 8088
cd backend
$env:JAVA_HOME = "E:\JDK17\jdk-17.0.1"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:XK_MYSQL_PASSWORD = (Select-String -Path ..\.env -Pattern "^MYSQL_ROOT_PASSWORD=(.*)$").Matches.Groups[1].Value
.\mvnw.cmd -o -q spring-boot:run

# �?前端 5180
cd ..\frontend
npm run dev

# �?prod（要�?18080 才拉；不拉也不影�?dev�?
cd ..
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d
```

**别假�?prod 会自己回�?*：它的容器都�?`restart: unless-stopped`�?
Docker 起来后通常会自动重启，�?2026-10-11 那次�?*全部手动起来�?*�?
起完 Docker �?`docker ps` 看一�?`xiaoku-prod-*` 有没有，缺了就按 �?拉�?

</details>

**重启后想直接跑测试，还要确认这三�?*�?
后端 8088、前�?5180、`xiaoku-redis` —�?缺任何一个的症状都长得不一样，
但都表现为「测试大面积失败」而不是「环境问题」：
`ui-*.mjs` 报「开发服务器没起来」是 5180 缺；契约测试�?
`10005 未登录`/`Bearer undefined` 是后端缺�?redis 缺�?

⚠️ **Docker Desktop 整个停掉时的症状**：四个中间件全没，`docker ps` 直接�?
`cannot connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`�?
而后端起不来的报�?*藏在** `spring-boot-maven-plugin` 那句
`Process terminated with exit code: 1` 后面 —�?真正的原因在日志上方几百行：
`Connection refused: 127.0.0.1:6379`�?*看到 exit code: 1 �?`docker ps`
确认引擎在不�?*，再决定是起容器还是查代码�?

⚠️ **dev �?Redis 曾经是「借」来�?*：dev compose 原来只有 mysql/kafka/es�?�?`application.yml` �?Redis 默认指向 `127.0.0.1:6379` —�?开发期实际�?*另一�?项目**（compose project `community`）的 redis 容器提供。那个容器一停，本项目后�?就起不来，而报�?*藏在** `spring-boot-maven-plugin` 那句
`Process terminated with exit code: 1` 后面�?
```
Caused by: RedisConnectionException: Unable to connect to Redis server: 127.0.0.1/6379
```

不往上翻日志会以为是代码问题�?026-10-05 已把 `redis` 服务正式加进
`docker-compose.yml`（只绑回环、`appendonly no`、带 healthcheck），
`docker compose up -d redis` 即可。以�?*先看 `xiaoku-redis` 在不�?*再排后端�?
**�?MySQL 只能这么写（2026-09-29 实测，其他写法全部失败）**�?
```powershell
$pwd = (Select-String -Path .env -Pattern "^MYSQL_ROOT_PASSWORD=(.*)$").Matches.Groups[1].Value
$env:MYSQL_PWD = $pwd   # 别用 -p：交互式会索要口令，非交互式又会把口令打到日志里
& "E:\Web\MySQL\bin\mysql.exe" --no-defaults --host=127.0.0.1 --port=3309 --user=root "--execute=SELECT 1"
```

两个坑：

1. **必须 `--no-defaults`**：这台机�?option 文件（`C:\WINDOWS\my.ini` 等）�?   MySQL 9.0.1 客户端不兼容�?*不加这个开关时 mysql 只会打一�?usage 然后退�?*�?   看起来像「SQL 写错了」，其实是根本没执行�?2. **必须用长参数 `--host=127.0.0.1`，不能用粘连的短参数 `-h127.0.0.1`**�?   粘连写法会被解析�?host=`127`，报 `Unknown MySQL server host '127'`�?
�?`mysql --version` 确认客户端本身是好的（`Ver 9.0.1 for Win64`）；如果�?`--version` 都打不出来，才是二进制本身坏了�?
---

## 3. 启动后端：口令变量是强制�?
```powershell
cd backend
$env:JAVA_HOME = "E:\JDK17\jdk-17.0.1"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:XK_MYSQL_PASSWORD = "<.env 里的 MYSQL_ROOT_PASSWORD>"   # 不设就起不来
.\mvnw.cmd -o -q spring-boot:run
```

**少设这个变量时的真实报错**�?026-09-27 实测，三种情况逐个试过）：

| `XK_MYSQL_PASSWORD` | 结果 |
|---|---|
| 未设�?| 启动失败：`Access denied for user 'root'@'172.20.0.1'` |
| 空串 | 同上 |
| 正确�?| 正常启动 |

⚠️ **不会**出现 `Could not resolve placeholder 'XK_MYSQL_PASSWORD'` —�?未解析的占位符在属性绑定阶段被当作空值放过了。所以看�?`Access denied`
时别只怀疑口令写错，**�?`echo $env:XK_MYSQL_PASSWORD` 确认变量在不�?*�?
`docker compose` 侧有独立的一道闸：`.env` 缺失�?`${MYSQL_ROOT_PASSWORD:?...}` 会让 compose 直接 exit=1 并打印中文提示�?已实测有效�?
---

## 4. 敏感信息：清洗历史后必须清掉副本

这条�?*硬性规�?*�?026-09-27 踩过一次：

1. 仓库历史被重写过（旧口令已从所�?commit �?tag 中移除并 force-push）�?   但重�?*之前**在临时目录留下过两份副本�?   `C:\Users\y\AppData\Local\Temp\opencode\red-book-backup`（Git 镜像�?   �?`env.bak`。里面仍�?*清洗�?*的旧密码 —�?历史洗了，副本没洗，等于没洗�?2. 这两份已删除，临时目录与工作区对旧口令零命中�?
**规则**�?
- 任何一次改�?Git 历史 / 移除敏感值之后，**先确认远端已同步**，再删所�?  清洗前产生的镜像、`.bak`、临时导出。删之前先核对副本里�?tag 哈希是否还是
  旧值（是旧值才说明它是清洗前的副本）�?- `.env` 永远不提交，`.gitignore` 已覆�?`.env` / `.env.local`�?- 代码与配置里**不留任何口令兜底�?*（`${XK_MYSQL_PASSWORD:}` 这种空串兜底也不行：
  它会�?恰好配了无口�?MySQL"的机器上静默连上）�?- 想改口令就直接改，别为了"方便"把默认口令写回仓库�?
---

## 5. 测试入口

改后端接�?�?必须跑契约测试；改前�?�?必须�?CDP 测试�?*别攒到最后一起跑�?*

```bash
# 后端（需后端已在 8088 运行）→ 621 �?cd backend && node scripts/contract-test.mjs
# 换地址：XK_API_BASE=http://ip:8088 node scripts/contract-test.mjs

# 前端（需前端 5180 + 后端 8088 同时在跑�?# �?42 + 8 + 160 + 27 + 78 + 49 + 19 + 9 + 26 + 23 + 20 + 139 = 600 �?cd frontend && npm run test:ui

# 单跑某一组：:smoke / :refresh / :note / :profile / :interaction / :follow /
#            :search / :idempotent / :notification / :admin / :message / :layout
cd frontend && npm run test:ui:interaction

# 前端类型 / 构建
cd frontend && npm run typecheck && npm run build
```

契约测试每次跑会新建 `ct_/ct2_/ct3_/ct4_/ct5_/ct_mod<时间�?` 等账�?（必须随机，固定账号会撞 `10003` 就测不到注册成功分支），**并留下它们的笔记和图�?*�?`ct5_` �?P7 搜索轮询的专用账号——搜索接�?60/min 限流，轮询用自己的额�?才不把断言账号的桶打空�?0 �?× 500ms �?25s 预算）�?`ct_mod<时间�?` �?P15 内容审核段的专用账号——发�?20/min/USER�?全文�?`note/publish` 出现 26 次，共用主账号必撞桶（详�?P15 段）�?
清理�?*两个**坑，第二个比第一个危险得多：

```sql
-- 0) 先把 ct 账号 id 落临时表：后面每�?DELETE 都锚在它上面�?--    既不用抄三遍正则，也保证「只删测试账号的东西」这件事肉眼可验�?CREATE TEMPORARY TABLE _ct AS
  SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$';
SELECT COUNT(*) FROM _ct;   -- 先看清要删几个，再往下删

-- 1) 顺序：先子表后父表。P5 之后有四张表挂在 note 下面�?--    comment_like 又挂�?comment 下面，少删一张就留孤儿行
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
-- 2) user_follow 无外键不级联（P6），必须在删 user 前先�?ct 账号两头的关系清掉，
--    否则留下 user_id / follow_id 指向不存在用户的孤儿�?DELETE FROM xiaoku_db.user_follow
  WHERE user_id IN (SELECT id FROM _ct) OR follow_id IN (SELECT id FROM _ct);
DELETE FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$';
```

1. **`REGEXP` 而不�?`LIKE`**：MySQL �?`LIKE 'ct_%'` �?`_` 是单字符通配符，会误删�?   正则里的 `[0-9]?` 也不能省 —�?写成 `^ct2?_` 匹配不到 `ct3_`，每跑一次漏一个常驻垃圾账号�?2. **每条 `DELETE` 都必须带 `WHERE`**：库里还�?`xiaoku_demo`、`xk_ui_smoke`�?   `xk_ui_interact`、`xk_ui_follow` 这些常驻 fixture 的笔记、评论和关注行�?   `DELETE FROM xiaoku_db.comment;` / `DELETE FROM xiaoku_db.user_follow;`
   这种全表清空会把它们一起删掉，而脚本跑完只显示「清理成功」，
   **没有任何迹象表明你顺手删了别的东�?*�?   ⚠️ 旧版这份文档里的清理 SQL 就是**每条都锚�?`xiaoku_db.note` �?*�?   （最后一�?`DELETE FROM xiaoku_db.note;` 甚至没有 `WHERE`），
   与它自己下一条禁令直接矛盾�?*照抄会连 fixture 的笔记一起删掉�?*
3. **ES 里会留下孤儿文档**：P7 起测试笔记会�?Kafka 进索引，删库不删索引�?   搜索回填时按 MySQL 过滤，结果不受影响；想彻底清空就�?   `POST /api/search/reindex`（需登录）从当前库重建�?4. **临时表在同一条语句里只能引用一�?*：`DELETE FROM xiaoku_db.user_follow
   WHERE user_id IN (SELECT id FROM _ct) OR follow_id IN (SELECT id FROM _ct)`
   会报 `ERROR 1137 Can't reopen table: '_ct'`，而且**报错之前那几�?DELETE 已经
   执行完了**（半截清理），别以为整段没生效。要么拆成两条语句，要么把子查询
   包一层派生表 `SELECT id FROM (SELECT id FROM ... ) k`（派生表会物化，不受此限）�?   这条 2026-10-01 实测踩过�?5. ⚠️ **SQL 里带中文条件字面量时，只能用 `--execute=`，不能走管道 stdin**
   �?026-10-06 实测）：`"�?WHERE title IN ('正常的咖啡探店记�?)" --execute="�?`
   能匹配到行，改成 `$sql | mysql` 之后同一条语�?`target=0` —�?管道进来时连�?   字符集与 `--execute` 不同，中文字面量被按别的编码解释，于�?*静默匹配不到任何�?*�?   症状和「SQL 写错了」一模一样，但反过来：没�?ERROR，只�?0 行。要清中文命名的
   行，先用 `--execute` 查出 **id**，再用纯 ASCII �?id 列表去删�?
删库不会删文件，图片还在 `backend/uploads/`（已 gitignore），要清就整个删掉�?
前端 CDP 测试的常�?fixture：`xk_ui_smoke`（登录冒烟）、`xk_ui_interact`
（互动搭�?常驻评论）、`xk_ui_follow`（关注流素材号，口令同为 `Xk@2026peer`）�?�?`10003` 都判为通过�?*三个都不要清�?*。测试需�?Chrome，路径可�?`XK_CHROME` 覆盖�?
库里另有一�?**P12-C 演示种子数据**：`backend/scripts/seed-demo.mjs` 造的 6 �?`xk_seed_*` 账号（口令统一 `Xk@123456`�? 22 篇真封面笔记，外�?`xiaoku_demo`
自己�?4 篇。脚�?*可重复跑**（按标题跳过已存在的），删库不删脚本，重跑即回种�?要清就按上面的模式把它和 `idem*`（`ui-idempotent` 每次跑新建的账号）一起删 —�?`REGEXP` 写成 `'^ct[0-9]?_[a-z0-9]+$' OR '^idem[0-9]+$' OR '^xk_seed_'`�?再把 demo 的笔记单独一并删（账号留着）。两条硬约束�?
- **demo 的粉丝数必须保持 0**：`ui-follow` 有断言「没人关注演示账�?�?粉丝空态」�?  所以种子里只有 demo→种子的关注�?*没有反向�?*，别"顺手"加对称关注�?- **种子标题/正文避开「笔�?/ 测试 / 关注�?*：`ui-search` 断言
  「搜 `P6 关注流测试笔记` 第一张卡就是它」，ik_smart 切词 + multiMatch �?OR�?  种子内容吃了这些词就会抢相关度排到前面去�?
### 读测试结果时的一个坑

契约测试输出�?UTF-8 中文。在 PowerShell 里用
`node x.mjs | Select-String "通过"` 匹配�?*中文会因控制台编码对不上而匹配失�?*�?很容易误判成「测试挂了」。稳妥做法是落盘再读�?
```powershell
node scripts/contract-test.mjs > "$env:TEMP\ct.txt" 2>&1
Get-Content "$env:TEMP\ct.txt" -Encoding UTF8 | Select-String "====="
# 或直接看 $LASTEXITCODE
```

---

## 6. 雪花 ID：Long 必须序列化成字符�?
这条�?P3 用契约测试抓出来�?*真实缺陷**，不是风格偏好：

```
后端 ID  = 362756654342606850          �?0^17 量级�?JS 解析�?= 362756654342606848          JSON.parse 静默四舍五入
```

JS �?`Number.MAX_SAFE_INTEGER` 只有 `9007199254740991`（约 9.007×10^15）�?超出�?*不抛错、不告警**，只是数悄悄变了。后果是回传 ID 查详情直�?`20001 笔记不存在` —�?表现成「数据明明发过却查不到」，极难定位�?
因此�?
- `JacksonConfig` 只对 **Spring MVC �?ObjectMapper** 注册 `ToStringSerializer`
- **不要**�?`RedisObjectMapperProvider`：那是另一�?ObjectMapper 且带
  `activateDefaultTyping`，缓存里落成字符串后反序列化�?`UserVO` 会类型不匹配
- �?ID 的数值别�?`Long`：`LoginVO.expiresIn` 已改�?`Integer`�?  `PageVO.total/page/size` 也已改成 `Integer`（P5 踩过同一个坑：它被序列化�?  `"1"`，前�?`total === 1` 恒为 false�?- 前端 `types.ts` �?`SnowflakeId = string`，赋值时不要 `Number()` / `parseInt`
- 契约测试里有两条断言专门钉这件事（类型必须是 string、BigInt 必须 > MAX_SAFE_INTEGER�?
## 6.1 `non_null`：`null` 字段�?JSON 里是「不存在�?
`application.yml` 配了 `default-property-inclusion: non_null`�?所�?*值为 null 的字段会整个�?JSON 里消�?*，前端拿到的�?`undefined` 不是 `null`�?
```
VO { id: "123", avatar: null }   �?  { "id": "123" }
```

因此判断「有没有值」必须用 `== null` 或真值判断，
�?`=== null` 会永远走进「有值」那个分支，�?`'avatar' in obj` 同理�?前端 `types.ts` 里的 `Nullable<T>` 就是这个约定�?
## 6.2 前端 `request.ts` �?`get(url, params, config)`

**第二个形参直接就�?query 参数本身，不�?axios config�?*

```ts
get('/comment/list', { noteId, page, size })          // �?get('/comment/list', { params: { noteId, page } })    // �?发出 ?params[noteId]=...
```

后者语法合法、`vue-tsc` 也不报错，但 axios 会把整个对象�?*一�?*参数序列化，
后端收到「缺少必要参数：noteId」�?*契约测试抓不�?*，因为它走裸 HTTP
绕开了整个前端封装层，只有真机点一下才会暴露�?
## 7. 已完成状态（2026-09-30�?
- P0 环境编排 / P1 统一响应与异�?/ P2 用户模块 + JWT / P4 部分（登�?+ 首页）已合并推�?- 品牌改名已落地（`62ed4c5`），测试通过且未改任何测试断言
- 契约测试已落盘（`f8f412c`），现为 **222 条断言**（P2 44 + P3 32 + P5 58 + P6 69 + P7 19�?- 口令兜底修正 + 注释订正（`cf93b22`�?- AGENTS.md 本身已提交（`3978ed0`�?- P3 后端已推送（`fd4140e`），含雪�?ID 精度修复
- P4 前端已完工（登录 / 首页 / 发布 / 详情 / 我的五页 + 69 条断言�?- P5 互动域已完工并推送：点赞 / 收藏 / 评论 + 契约 134 �?+ CDP 110 �?  - `module/note/` 发布 / 详情已实现；`common/storage/` 抽出 `ImageStorage`
    抽象，`type=local` 落本地盘、`type=s3` �?S3 协议
  - 上传文件�?*一律服务端生成 UUID**，扩展名�?content type 白名单反推，
    绝不使用用户提供的原始文件名（防路径穿越与扩展名伪装�?  - 笔记域错误码已在 `ErrorCodeEnum.java:39` 预留并在用：
    `NOTE_NOT_FOUND` / `NOTE_STATUS_ILLEGAL` / `NOTE_UPLOAD_FAILED` /
    `NOTE_IMAGE_LIMIT_EXCEED`�? 张上限）
- P6 关注域已完工：关�?/ 取关 / 关注列表 / 粉丝列表 / 作者主�?  / 关注�?+ 契约 203 �?+ CDP 135 �?  - `module/follow/`（`UserFollowEntity` / `FollowUserVO` / 两个 service /
    `FollowController`�? `module/feed/`（JOIN SQL�? 笔记域只读改�?  - `user_follow.status` �?*闲置弃用**：关�?取关走物理删，唯一索引当裁�?  - `NoteVO` 新增 `authorId` + `authorFollowed`（P4「不暴露作�?ID」的决定被反转，
    三处注释一对）；列表卡片用新的 `NoteListItemVO`
  - `GET /api/follow/user/{id}` 作者卡片一次往返拿全（UserVO 字段 + followed�?  - feed �?`INNER JOIN user_follow` 而不是先�?IDs �?`IN`
  - 前端新页：`FollowListView.vue`（`/follow/:id` �?`/fans/:id` 双路由共用）�?    `UserView.vue`；首�?env 自检卡移除换成关注流；详情页作者区加关注按�?  - `schema.sql` �?P0 就已建好全部 8 张表，含 `note` / `note_image`�?    **P3 没有�?schema**
- P7 搜索域已完工（本 commit）：ES 检�?+ Kafka 异步同步
  + 契约 **222 �?* + CDP **154 �?*
  - `module/search/`：`NoteEventDTO` / `NoteSearchDoc` / `NoteSearchRepository` /
    `NoteSearchConsumer` / `SearchService(Impl)` / `SearchController`
  - 接口：`GET /api/search/note?keyword=&page=&size=`�?    `POST /api/search/reindex`（删旧索�?+ �?MySQL 全量回灌，需登录�?  - **`KafkaConfig.xkProducerFactory` 有真实缺�?*：P0 手写�?config map 漏了
    `bootstrap.servers`，启动不报错�?*首次真发消息**才抛
    `No resolvable bootstrap urls`。已改为 `kafkaProperties.buildProducerProperties(null)`
    打底再覆盖自有键。另�?`kafkaErrorHandler` bean（DLT + `FixedBackOff(1s,3)`�?- P8 四件套已完工（本 commit）：限流 / 幂等 / 布隆 / 分布式锁 + Redis 计数权威
  + 契约 **276 �?*（P2 44 + P3 32 + P5 58 + P6 69 + P7 19 + P8 54�? CDP **163 �?*
  - 限流 `common/annotation/RateLimit` + AOP + Lua（`INCR`+首次 `PEXPIRE` 原子）：
    register/login �?IP，publish/image/comment/search/reindex �?USER�?    Redis 异常 fail-open；契�?16.1 �?  - 幂等 `common/annotation/Idempotent` + AOP + Store：请求头 `X-Idempotency-Key`
    对齐 Stripe（不给头不生效）；回放返�?*原方法返回类�?*序列化的缓存 JSON
    （CGLIB 代理的坑，P8 契约抓过）；前端 `request.ts` �?`_xkIdemKey` +
    note/comment 接口 `idempotent:true`；契�?16.2 �?+ CDP `ui-idempotent.mjs`
    �? 条，Fetch 域拦截篡�?Authorization 精确模拟 401�?  - 布隆 `common/support/NoteIdBloomFilter`：FNV-1a64 + Kirsch-Mitzenmacher�?    �?SETBIT/GETBIT，启�?`BloomWarmUpRunner` 全量回灌，向左查详情短路 20001�?    **容错三件事（都踩过）**�?1) 位图 key 被外部清掉时 `mightContain` 放行
    （否则全站真实笔�?404）；(2) `add()` �?key 缺失降级为不过滤，绝不重�?    残缺位图�?3) 位下标依�?bitCount，改 config 必须 `#reset()` 重灌
  - 分布式锁 `common/support/LockTemplate`（Redisson 薄封装，fail-open）：
    挂在 `SearchServiceImpl.rebuildNoteIndex` 上，reindex 并发互斥返回 50001�?    契约 16.0 节（`Promise.all` 并发同打�?  - **Redis 计数权威 + 异步落库**（推�?P5「DB 列即权威」）�?    - ZSet `xk:note:like|collect:users:{noteId}` 是当前权威，member=userId�?      DB 关系行照�?insert/delete（唯一索引当裁判）兼作持久底账
    - 写只�?ZSet + `SADD xk:note:dirty`，不再每�?UPDATE 一次列�?      key 缺失时先�?DB 关系�?*全量重建**再合入本次变更（防裸 ZADD 顶掉老成员）
    - 读走 `ZCARD`（列表页整页 pipeline �?EXISTS �?ZCARD）；**key 缺失回退
      「DB 关系行实�?COUNT」而不�?`note.like_count` �?*——列是异步产物，
      回退列会让详情页对不上刚点的 +1（P8 契约有断言钉）
    - `NoteCounterFlushJob` �?30s �?`xk:lock:note:counter-flush`，SPOP 一�?      �?noteId �?*绝对值覆�?*写回两列（幂�?/ 崩溃安全 / 多实例不打架）�?      ZSet key 空了会自动删除；dirty/位图 key 丢失都会**自动降级重建**�?      无需手动清理
    - 前端 `NoteDetailView` 切换点赞/收藏�?*只合并自己那一�?*：并发双键时
      后响�?VO 的另一维是它自己事务快照里的旧值，整包覆盖会随机回退
      �?`0|1`/`1|0`（CDP 实测，批�?5 修复�?  - P8 计数详情�?`NoteCounterStore` / `NoteCounterFlushJob` 的类注释 + README「P8」段
  - `NoteServiceImpl.publish` �?**afterCommit** 发事件（key=noteId，失败只记日志）
  - 消费�?`application.yml` 显式�?`JsonDeserializer` + `default.type`�?    因为生产端复用的�?Spring MVC 那个 `ObjectMapper`（Long �?字符串）
  - **ES 只存检索字�?*，命中后�?MySQL 组卡（昵�?计数/authorFollowed 都是当前值）�?    并按 id 映射重排以保�?ES 的相关度/时间�?  - 点赞/收藏/评论计数变化**不触�?*重建索引（计数在�?MySQL 时现查），漂移推�?P8
  - 前端新页 `SearchView.vue`（`/search?keyword=`，query 传关键词�? 首页搜索框；
    CDP 新组 `ui-search.mjs`�?9 条）复用 `xk_ui_follow` 的常驻素材笔�?  - 搜索域错误码 50xxx：`SEARCH_SERVICE_ERROR` / `SEARCH_KEYWORD_EMPTY`
- P9 部署 + 压测（本 commit）：**12122 请求 @ 133.8 req/s，p95 20.6ms / p99 45ms�?  失败�?0%，checks 7832/7832**
  - `deploy/docker-compose.prod.yml`：全栈内网（name=xiaoku-prod 网络），�?    frontend 暴露 `${XK_WEB_PORT:-80}`；backend 四中间件 depends_on healthy�?    kafka 容器内改 `PLAINTEXT://kafka:29092`（开�?9092 是给宿主看的，生产不适用�?  - `backend/application-prod.yml`（prod profile）：SQL 打印与外发日志关掉�?    `xiaoku.jwt.secret=${XK_JWT_SECRET}` 无兜底、`init-demo-data` 默认 false
  - `backend/Dockerfile`/`frontend/Dockerfile` + nginx.conf：多阶段构建，非 root�?    `AGENT REGISTRY_PREFIX`/`ARG REGISTRY_PREFIX` 支持镜像加速前缀（本机填
    `docker.m.daocloud.io/`，ES �?docker.elastic.co 不加）—�?*grafana/k6 不在
    daocloud 白名�?*，压测工具本机装
  - `deploy/.env.prod.example`：`MYSQL_ROOT_PASSWORD` / `XK_JWT_SECRET` �?    `${VAR:?}` 闸，缺一 compose exit=1；实�?`.env.prod` �?gitignore
  - 压测：`deploy/loadtest/seed.mjs`（Node 零依赖，幂等）�?1 作�?+ 12 笔记 +
    10 读者（关注 + 热评笔记 20 条评论）；`deploy/loadtest/mix.js`（k6）三场景
    browse 20VU/likers 6VU/authors 3VU�?0% 详情打伪 ID 体现布隆短路，k6 输出
    `deploy/loadtest/report.json`
  - **压测抓的三个边界**（都是规则不是故障）：nginx 拒收 URI 裸非 ASCII �?k6 �?    `encodeURIComponent`（浏览器自动编码，CDP 永远踩不到但 k6 一定踩）；
    作者不能评论自己的笔记�?0007）→ authors 场景不写评论，评论写入交�?browse�?    seed/压测必须在自己限流余量内跑（register 10/min、publish 20/min），被打回先
    怀疑脚本节�?  - 注意：loadtest 会在库里留下 `xk_lt_*` 账号与笔记（`ct` 清理 SQL �?REGEXP
    不会碰到它们，正常跑不受影响）；压测目标�?prod �?nginx 18080 而非 dev 8088�?    因为 dev profile �?debug+SQL 打印，会拉偏数据
- P10 五件套已完工（本 commit）：笔记编辑/上下�?+ 评论点赞 + IK 分词
  + �?P0–P9 标签 + 清理压测残留，契�?**332 �?*�?P10 56 条）+ CDP **174 �?*
  �?11 条评论点赞断言：interaction 41�?2�?  - **笔记编辑 / 上下�?*：`PUT /api/note/{id}`（body=NotePublishDTO 全量更新�?
    `PUT /api/note/{id}/status`（body `{status:1|2}`�? �?100001）。详情门禁：
    作者可见自�?status 0/2；非作�?0�?0001�?�?0002。`pageUserNotes`：本�?管理
    视图全状态，他人=�?status=1。图�?删旧重插；更新用 LambdaUpdateWrapper 显式
    set（含 null，避开 not_null 策略吞掉清空�?cover/videoUrl）；事件�?afterCommit
    发：编辑已发布→PUBLISH、已下架→UNPUBLISH、下架→UNPUBLISH、上架→PUBLISH
    （createTime 保持首发值）。两端点 @RateLimit(20/min, USER)，PUT 幂等不加头�?    契约 17.2 段覆盖「下架→搜索消失、上架→恢复可搜」的 Kafka 链路�?  - **评论点赞**：`PUT/DELETE /api/comment/{id}/like`，与笔记共用 30001/30002�?    like：评存在�?0005�? 父笔�?status=1�?0002）；唯一索引防重�?0001�?    仅插入成功才 `like_count+1`。unlike：评论存在（30005）；�?0 行→30002�?    `GREATEST(0, like_count-1)`�?*刻意不做笔记状态门�?*，规避笔记侧
    「下架后取消失败连带回滚」的坑（P5 缺口之一）。前端详情页根评�?+ 回复都可赞，
    只合�?liked/likeCount 单维（对�?P8 并发语义），30001/30002 静默整页重拉�?  - **IK 中文分词**：`deploy/es/Dockerfile` 自建 ES 镜像�?analysis-ik 8.17.6
    （zip �?`deploy/es/ik/` �?gitignore 不入库），dev/prod compose �?    elasticsearch 均改 `build:`。`NoteSearchDoc` 索引�?`ik_max_word`�?    查询�?`ik_smart`（标准用法）。换 analyzer 后必须重建索�?    （`POST /api/search/reindex`），�?mapping 不会自动升级——本次就是这么抓的：
    �?reindex �?mapping 仍是 standard，因为跑的是改动前旧类，重启后端�?reindex 才对�?  - 清理：删�?dev `ct_%` 测试账号 + prod `xk_lt_*`/`prod_smoke1` 压测残留
    （prod 27 笔记 + 80 评论 + 10 关注），prod/dev ES �?reindex 清掉已删笔记�?    孤儿文档（prod 用临时账�?`prod_clean` 注册→reindex→删号）
  - git 标签：v0.3–v0.9 已补（对�?P3–P9 收官 commit），与既�?v0.1/v0.2 同风�?  - **prod ES 仍是�?standard 镜像**：只改了 prod compose �?`build:`，没重建
    prod ES 容器；下次部署重�?`docker compose -f deploy/docker-compose.prod.yml
    --env-file .env.prod up -d --build` 时自然带�?IK。dev 已生效并回归（契�?332
    + 搜索 CDP 19 条全绿）
    ⚠️ **这条已于「prod ES �?IK」一轮修掉，2026-10-04**：prod ES 现在
    `analysis-ik 8.17.6` 已装、`xk_note` mapping 已是 `ik_max_word`/`ik_smart`�?    过程中踩了三个坑，见下面「prod 栈运维」段�?- P11 小红书对齐已完工（本 commit）：作者自评放开 + 图文必带�?+ 删除笔记
  + 契约 **355 �?*�?P11 23 条）+ CDP **184 �?*�?74 �?184，ui-note 17�?7�?  - **A 作者可评论自己笔记**：`CANNOT_COMMENT_SELF_NOTE`(30007) 枚举保留不删�?    只移�?`CommentServiceImpl` 的检查（自评/自回复合法）。契�?14 节断言翻转
    （作者自评成�?+ 自删 + commentCount �?0），16.2 幂等「业务失败」触发源�?    成「给不存在的笔记评论 20001」（原来自评触发 30007 的路径已合法）�?  - **B 图文发布必须至少一张图**：`validatePublishParams(dto, requireGraphicImage)`
    —�?publish �?`true`，update �?`false`（保�?P10「编辑可清空图片」语义）�?    �?�?空组 `imageUrls` 一�?10001。契�?11 节新增断言�?  - **C 删除笔记**：`DELETE /api/note/{id}` 作者本人，非作�?不存在一�?20001
    （防探测）。事务内级联 `comment_like �?comment �?note_like �?note_collect �?    note_image �?note`；afterCommit �?`ACTION_DELETE` 事件�?    `NoteSearchConsumer` `deleteById`；`NoteCounterStore.removeCounters` �?Redis
    ZSet/dirty 键（fail-open）。用户头�?笔记图片文件本体仍留�?    `backend/uploads/`（gitignore），要清就整个目录删�?  - **契约测试 17.4「删除」段 & 三个踩过的坑**：①搜索断言词必须用独立随机锚点
    `delUnique='delok'+random`�?*不能复用共享 stamp**——ik_smart 拆词 + multiMatch
    OR 会撞车同 stamp 的其它笔记（实测 total=20 永不归零）；②轮�?评论改用
    `rlAuth`（`pollAuth` �?60/min �?P7+17.2 轮询打空，`actorAuth` 的评�?    10/min 被打满）；③`/api/comment/list` 对已删笔记返�?**20001** 而非空列�?    （断言�?20001 写）�?7.4 全链：发一条带图笔记→互动→评论→删除→详�?20001
    →重复删 20001→作者主页消失→评论列表 20001→ES 轮询消失�?  - **前端**：`api/note.ts` 新增 `updateNote` / `changeNoteStatus` / `deleteNote`�?    新建 `NoteEditView.vue`（`/edit/:id(\d+)`，编�?新图即传+全量覆盖，可移除图片�?    可直接手�?URL 但非作者会被后�?20001 拦）；`NoteDetailView.vue` 作者操作区
    `[data-test=note-author-ops]`（编�?下架·上架/删除，删除有 Vant 二次确认）�?    `types.ts` �?`NoteVO` 补上 P10 就有�?`status` 字段�?*P10 漏补，typecheck �?*）�?  - **P11 �?CDP 所有发布流程都要先传图**：ui-interaction / ui-idempotent 补了
    `makePng + setFiles`。Node �?fetch 上传（ui-idempotent �?5 节）有个坑：
    `new Blob([buf])` 默认 `application/octet-stream` 会被内容类型白名�?    100001 拒掉�?*必须 `{ type: 'image/png' }`**。ui-note 27 条含新增作者操作段
    （编辑回�?保存 / 下架按钮切换 + 作者仍可见 / 删除确认→首页→20001），
    复用当次发布的笔记，不额外消耗登�?注册限流�?  - interaction 组的「删除后详情页评论计数归零」断言原来是同拍短读，偶发读到
    旧�?flake；已按本文件惯例改成「先 waitFor 落定再断言」�?  - git 标签：v1.0（P11 收官 commit）�?- P12 响应�?+ 纯文字笔记已完工（本 commit）：**后端零改动，契约�?355 �?*�?  CDP **199 �?*�?84 �?199：smoke 18�?4、note 27�?6；P12-C 追加 layout �?  27 条后�?**226 �?*�?  - **纯文字也能发笔记**：`utils/textCard.ts` �?`<canvas>` 把标�?正文渲成
    **3:4 竖版文字卡片**�?00×1200），正文按行数分页（�?13 �?/ 续页 17 行，
    最�?6 页），逐页 `toBlob` �?`new File([blob],'text-card.png',{type:'image/png'})`
    �?�?*已有** `uploadImage` �?`publishNote({imageUrls})`�?    **后端「图文必须带图」规则一行没动，前端自己把不变量满足�?* —�?这就�?    小红书那套「文字用模板生成图片」的复刻。后�?契约/搜索/计数全不受影响�?  - 四个踩过的点�?    1. **canvas 读不�?CSS 变量**，`textCard.ts` 自带一份与 `main.css` 同名
       token 的调色板常量（`PALETTES`），改色要两边同步（文件头已注明）�?    2. **预览必须跟着主题重绘**：最�?watch 只监�?title/content/files�?       用户在发布页切深浅色时预览还是旧配色的旧图。修法是 watch 数组里加
       `useTheme().isDark`（两个视图都改了）。注意直接写
       `document.documentElement.dataset.theme` **不会**触发重绘 —�?       主题的真实状态在 `useTheme` �?ref 里�?    3. **CDP �?headless Chrome �?`prefers-color-scheme` �?dark**�?       首次进页面就是深色主题，写「浅色卡片」相关断言时别默认 light�?    4. **文字卡片排版只能靠像素分析验**（这台机上我读不了图）：临时脚本解码
       PNG、按行统计「非底色像素」找行段，确认真实落�?       品牌�?y�?0-114 / 标题 166-211 / 琥珀分隔�?244-256 / 正文 258-491 /
       落款 y=1136。这个脚本是临时的一次性工具，不入库�?  - **P12-B 桌面响应�?*（原�?9 个页面的根容器全�?`max-width:480px`�?    **0 处布局 `@media`**，桌面打开就是一�?480px 竖长�?—�?这就是「网页版
    和手机版一样大」的根因）：
    - `.page` 骨架�?9 处重复收�?`main.css` 全局类，**scoped 样式里那�?      `max-width:480px` 必须删掉**，否则全局断点（特异�?0,1,0）永远打不过
      scoped �?`.page[data-v-x]`�?,2,0）—�?这是最容易白干一遍的坑�?    - 断点两级：≥768px 过渡�?40px 宽），≥1024px 桌面主力�?200px）�?    - **`SiteNav.vue`**：≥1024 才显示的顶部通栏（品�?搜索+首页/发布/我的/
      关注/主题/退出），`<1024` �?`display:none`，且首页自己�?`.top` 在桌�?      收起 —�?否则两条顶栏并排。登录页不挂（`route.name === 'login'`）�?    - 抄小红书的构图：首页/作者主�?搜索结果 = **CSS `columns:3` 瀑布**�?      卡片化（描边+硬阴�?`3/4` 封面），类名�?data-test 一个没动；
      详情�?= **左图右栏**两栏 grid�?    - 详情页两栏用**扁平子元�?+ CSS grid 显式摆位**（`.title/.who/.content/
      .grid/.stats` 各自 `grid-column`），外层 `.detail-grid` 在移动端
      `display:contents` —�?这样移动�?DOM 顺序（标题→作者→正文→图片→计数�?      与改造前**完全一�?*，只有桌面才换位。不要为了排版去重排 DOM 顺序�?    - 无图笔记（改图清空后）用 `:has()` 退回单栏居中，不留一整片空白左栏�?    - 补了桌面交互：`:hover`（以�?*只有** `:active`，鼠标放上去毫无反应�?      这才是「按键不好」的真实来源�? 全局 `:focus-visible` 焦点环�?    - `index.html` 去掉 `maximum-scale=1, user-scalable=no`（保�?      `viewport-fit=cover`）：桌面要能缩放，锁死缩放是无障碍问题�?  - 两条 CDP 新断言（都�?430×900 窗口里用
  `Emulation.setDeviceMetricsOverride` 切到 1280 �?`clearDeviceMetricsOverride` 切回）：
  smoke �?SiteNav 显隐/`.top` 收起/`.page` maxWidth �?1280 �?430 �?  分别�?1200 �?480 + **直接查样式表 CSSOM 里存�?`columnCount==='3'`
  �?�?024px 规则**（关注流在演示账号下可能为空，DOM 上没 `.items` 可量�?  所以查规则而不是查元素）；note �?`.detail-grid` 计算�?`display:grid`
  �?*图片左边�?< 标题左边�?*（真几何断言），切回后两者对齐恢复单列�?  （P12-C 起首页是 4 列，这条断言已放宽成 `columnCount >= 3`。）
- P12-C 桌面返工 + 演示数据已完工（�?commit）：契约�?355 条，CDP **226 �?*
  �?99 �?226：新�?layout �?27 条）。上一版桌面被判定「只是把尺寸拉大」：
  - **六个�?bug**（全部由 `ui-layout-audit` 的几何体检复核）：SiteNav 搜索�?    `.input` 不给 `flex:1 1 auto; min-width:0` 会溢出顶栏；计数器压字要�?    `.field` 两行 grid（`minmax(0,1fr) auto`）而不�?`padding-right` 打补丁；
    文档级横向溢�?`doc=453/430`；详情图被基础规则�?`aspect-ratio:3/4` 裁切
    �?*媒体查询必须放在基础规则之后**，同特异性下 source-order 决定胜负�?    ProfileView �?NoteDetailView 各踩过一次）；首�?228px 空洞；桌面两条顶栏�?  - **桌面 token 覆盖�?*�?`main.css` 末尾，selector 必须�?    `:root, :root[data-theme='dark']` —�?只写 `:root`�?,1,0）压不过暗色�?    `:root[data-theme='dark']`�?,2,0），暗色下整块白改。移动端保持 2px 粗描�?    + 硬阴影，桌面才切 1px + 软阴影（`--xk-stroke-w` / `--xk-shadow-hard` / `--xk-radius-blob`）�?  - **未定�?CSS 变量是「组件乱」的另一半根�?*：`--xk-accent`、`--xk-text-1`�?    `--xk-surface-1` 全站根本不存在（真名�?`--xk-amber` / `--xk-text` /
    `--xk-surface-2`），`.submit` 因此是白字透明底、浅色下近乎隐形。改任何
    `var(--xk-*)` 前先确认它在 `main.css` 里有定义 —�?**CSS 里引用未定义变量
    不报�?*，只是静默按 inherited/initial 走�?  - **`frontend/scripts/ui-layout-audit.mjs`**（`test:ui:layout`，已并入 `test:ui`）：
    6 �?× 2 视口的几何体检（文本宿�?vs 控件两两矩形相交、`.page` 内横向溢出�?    文档�?`scrollWidth > innerWidth`�? 桌面/移动 token 各一条。两个设计点�?    **登录页要在登录前体检**（登进去�?`#/login` 被守卫重定向回首页，量的是首页）�?    **详情页取有图笔记走关注流**（搜索关键词只会命中无图旧文，落�?`:has()`
    单栏兜底分支，两栏主分支就测不到）。计�?Track 4 的五条关键尺寸断言已补�?    ①首�?`columns=4` 且相邻列�?100px（取 `.items` 子项 left 去重）；②详情图�?    440±8（量 `.detail-grid .grid` 的实际宽）；③详情图 `object-fit=contain`�?    ④发布页**填满 64 字再量一�?*（原�?setter + input 事件�?v-model�?*不能 goto
    会清空表�?*）—�?计数与输入不相交 + 文字卡预览存在且 `max-height�?80`�?    ⑤首页真封面 `naturalWidth�?080`（`decode()` 等解码完再量，lazy �?0 会假红，
    钉死 8×8 回归）。`node scripts/ui-layout-audit.mjs --report` 另出**量化体检�?*
    （行�?首屏占用/字号直方�?WCAG 对比�?点击热区/卡片宽高比），只打印不断言�?    目前体检表暴露的已知项（有意未改）：`--xk-text-3` �?meta/label 对比�?�?.1-2.5
    低于 WCAG AA；SiteNav 链接热区 48×31<40px；字�?16/18/21/26px 在计划字�?    �?2/13/14/15/17/20/24/30）之�?—�?收口属于 Track 1 的「间�?字号阶」配套，
    改动面是全部 9 个视图，留待用户拍板后再做�?  - **计划 Track 1/3 的三处收�?*（本轮补）：`main.css` 桌面块给 Vant 覆盖
    `--van-radius-sm/md/lg`（默�?2/4/8 太碎 �?6/10/16 对齐 blob；Vant �?shadow
    变量，组件阴影改不了）；发布/编辑页桌�?`.card-preview` 限高 `420px + contain`
    �?:4 卡在 380 栏自然高 507px 会顶出首屏，`width:auto + margin-inline:auto`
    保比例不裁）；三�?`.count` 字号 11�?2px 回到字阶内�?  - **`backend/scripts/seed-demo.mjs` 演示种子**：在页面里动�?    `import('/src/utils/textCard.ts')` �?`brandCoverBlob` �?1080×1440 封面
    （让 Vite 转译 TS，Node 侧零依赖）→ 真实 upload/publish�?    **登录限流 60 �?分钟（IP�?*：令牌只在开头每账号登一次，之后切身份靠
    `localStorage` �?token，全�?login 一定撞墙（实测会中�?429）�?    清掉的旧垃圾 113 篇（`xiaoku_demo` 58 �?8×8 纯色碎图 + ct/idem/seed）�?  - 种子数据暴露�?*两条测试真缺�?*（修的是测试的错误假设，不是迁就实现）：
    �?`ui-follow` �?*第一�?*关注流卡片就当素材笔�?—�?素材笔记只发过一次�?    `createTime` 是旧的，种子笔记更新、排在它前面，于是取关取错人�?    「取关后素材笔记从关注流消失」永远等不到超时。改�?*按标题找卡片**�?    �?`ui-interaction` 的「评论计数同步为 1」是同拍短读（列表渲�?�?详情重拉
    的数字跟上），偶发读�?0，按 P11 的惯例先 `waitFor` 落定再断言�?- P13 字号/间距�?+ 文字卡模�?+ 卡片内边距（�?commit）：契约�?355 条，
  CDP **240 �?*�?26 �?240：ui-note 36�?6、layout 27�?1）。用户反�?  「卡片排版不对、详情页展示不对」，两个真根因：
  - **根因一 `wrapText` 不认 `\n`**：逐字符排版把换行折进同一行，canvas
    `fillText` 又不�?`\n`，段落结构画成「一个空格宽的缺口」。改为按段切行�?    空行保留（`if (!text) return []` 防空内容多页）。像素复测（临时脚本�?    不入库）量墨带：行距�?56、空行保留、正文不压落�?y�?136�?  - **根因�?`.card` 从来没有 padding**：详�?发布/编辑/我的/搜索的卡�?    padding 历来�?0（git 历史查无规则，P12-C 几何体检不查 padding 所以没
    暴露），文字贴着 2px 描边。`main.css` 补全局 `.card { padding:
    var(--xk-card-pad) }`�?8px，≥1024 覆盖 24px），scoped 里的字面量同步换 token�?  - **字阶/间距阶收�?*（Track 1 遗留，拍板后本轮做完）：`--xk-fs-*`
    �?2/13/14/15/16/17/20/22/24/30�? `--xk-space-*`�?�?8），全站
    `font-size: Npx` 机械归阶�?1�?2�?8�?7�?1�?0�?6�?4�?8�?0，leftover 0）；
    **文本输入框一�?16px**（iOS 聚焦自动缩放）；返回�?顶栏链接/模板按钮
    热区 �?0px�?  - **文字�?6 套模�?*（paper/ink/amber/mint/blush/blue，palette 手算对比�?    �?.5:1�? 发布/编辑页选择器（`tpl-list` / `tpl-{id}`�? 预览分页�?    （`text-card-pager`，长�?`1/N` 翻页、缩回单页自动收起）。模板与 app 主题
    **解�?*（`defaultTemplateId()` 只给起步值：暗色→墨黑，之后跟人走）�?    `currentTextTheme` 删除。正�?30�?2px / 行高 56�?  - **layout-audit 新增 4 �?*（双视口 ×2）：详情�?padding>0、发布页输入
    �?6px。正是它们抓出这次的 Profile 桌面回归：全局 padding 让侧�?`.names`
    �?112 压到 64px，`@xiaoku_demo`�?8px）溢出压「编辑」按�?—�?侧栏
    260�?00px + `.username` 省略号兜底（长用户名本来就该省略）�?  - **ui-note 新增 10 �?*：模板切换改预览 dataURL、`buildTextPages` �?`\n`
    切行（模块级直接 import 断言）、长文分页器 `1/2�?/2` 且预览换图、缩回短�?    分页器收起、输入字�?�?6px、详情卡 padding>0 + `white-space: pre-wrap`�?  - **调试可用的通用资产**：CDP `CSS.getMatchedStylesForNode` 查规则�?    「先 waitFor 登录序列再量」的诊断模板，本轮都验证过；一次性诊断脚本用完即删�?  - **v1.2 之后的截图反馈修�?*：标题下分隔线压住正文首�?—�?线底 256 �?    32px �?ink �?�?56 �?**0px 间隙**（硬编码 `ty+12`/`ty+48` 叠放，两行标�?    318/318、续�?8px 同病）。`drawPage` 改语义化三段留白（标题→18→线 10�?    26→正�?ink 顶→24→基线），首基线 280�?10 / 342�?72 / 续页 140�?74�?    最�?1070 �?< 落款 1112。附带收益：横线纸模板的纸纹正好落到基线�?    6px，「字坐线上」不再穿字�?*这台机器现在能直接读�?*（Read 工具�?    `img/*.png`），修复前后用渲染截图逐张人工验收过，读不了图是旧结论�?  - **v1.2 之后的截图反馈修复（二）—�?详情页「多图遮挡不能切 + 标题正文
    一大片空白�?*，CDP 240 �?**244**（ui-note +4），契约�?355�?    - **图改轮播**：`ul.grid` 摆全部图�?�?`van-swipe`（VantResolver 自动
      注入，`van-swipe-item` 单张 CSS 齐全）。图框比�?`--img-ratio` 跟当�?      图真实宽高比走（竖图占满、横�?440×293 缩帧不留灰带）；桌面箭头
      �?68 显示 + 计数�?`1/2`，手机靠手势�?*不能�?`loading="lazy"`**�?      非当前张平移出可视框后浏览器判不相交就不加载，解码断言永远等不到�?      `van-swipe` 横向位移只依赖宽度，高度变化无需 `resize()`（源码已核）�?    - **两栏空白的真根因有两�?*：① �?`grid-row: 1/-1` 在隐式网格里退化成
      单行，整摞图片高度灌进第一�?�?标题右下方空到作者行；修法是图框
      **绝对定位挂左�?* + 容器 `min-height` 与图框同源（`--media-h =
      min(660px, 72vh, calc(440px / var(--img-ratio)))`），右栏四块回归
      纯自动行。② 修完量出**每行之间仍空 106px** —�?`min-height` 高出右栏
      内容总和时，默认 `align-content: stretch` 把剩余高�?*摊进每个自动�?*�?      �?`align-content: start` �?title→作者实�?20px�?16 margin+4 gap），
      ui-note 断言 `< 40px` 钉死两层回归（旧�?70/106 都会挂）�?    - **layout-audit 终态等�?*：`auditPage` 固定 700ms 在全量连跑时不够
      （idempotent 压完后端、首页关注流没回来就�?�?`.items` 不存在报
      `cols=undefined`，单跑复现不了）。改成等 `feed-loading` /
      `follow-loading` 标记消失（超时按老节奏继续）�?    - 验收�?280/430 三张截图（竖图帧 440×587、横图缩帧、手机单列顺�?      不变）读图核对；临时诊断脚本 `_diag-detail.mjs` 用完即删�?      它发的临时笔记已�?DELETE API 清掉�?    - ⚠️ **本段描述的整套机制（绝对定位图框 / `--media-h` / `align-content:start`�?      已在第六轮整体删�?* —�?它是为了「评论进右栏」才存在的，而用户要的是评论
      在照片下方。留着这段是为了说�?*为什么不�?*再用那套：一个跨栏共享行�?      网格不管怎么摆，右栏内容一变长，左栏的评论都会被顶下去�?  - **v1.2 之后的截图反馈修复（三）—�?点赞/收藏/评论吸底操作�?+ 三键降权**�?    CDP 244 �?**269**（ui-note 50�?0 +10、layout 31�?6 +15），契约�?355
    （纯前端，后端零改动）：
    - **结构**：`.stats` 三键块与 `.editor` 评论输入合并成一�?      `[data-test=action-bar]`�?*放在卡片最底部（`.comments` 之后�?*�?      一�?DOM 两种落位：移动端基础样式 `position:fixed` 吸底（fixed 脱离
      流，DOM 在哪儿都不影响它贴视口底；被遮的评论尾部�?`main.page` 移动�?      `padding-bottom: calc(76px + safe-area)` 让位）；桌面 �?024 撤壳
      `position:static`，靠 `margin-left: calc(var(--xk-col1) + var(--xk-colgap))`
      与右侧文字左缘对�?—�?**左图下方留空**，两栏构图完全不变�?      桌面媒体块必须写在基础规则**之后**（同特异�?source-order 决胜负，
      ProfileView/NoteDetailView �?`aspect-ratio` 已踩过两次）�?    - **列宽单一来源**：`--xk-col1`�?40�? `--xk-colgap`�?2�?
      `--xk-col1-narrow`�?20 无图单栏）定义在桌面 `.card` 上，网格列模板�?      图框宽度、`--media-h`、操作栏缩进全部取它 —�?写死两处就会出现
      「网格改了、缩进没改」且只在桌面显形的错位�?    - **三键降权**：删可见文字标签（`.cap`），只留图标+数字；`border:0`�?      `background:none`，激活只变琥珀；读�?悬停�?`aria-label`/`title`�?      `data-test` �?`aria-pressed` 原样保留（ui-interaction 全靠它们）�?      图标�?`<van-icon name="like|like-o|star|star-o|chat-o">`
      （VantResolver 自动引入）。`.kbtn` min 40×40（P13 热区）�?      `.num` 14px + `tabular-nums`。输入框�?pill：`rows=1` +
      `field-sizing:content`�?0�?40px 封顶�? 发表按钮绝对定位�?pill �?      右下�?*flex �?textarea 必须 `min-width:0`**（SiteNav 搜索框前科）�?    - **桌面正文/标题加码**（注意力回到正文）：`.content` 16�?7px /
      line-height 1.75、`.title` 22�?4px，都在字�?token 内�?    - **重叠判定语义修正（不是绕过）**：吸底栏盖评论文字、发表按钮压
      输入框都是设计，`AUDIT_EXPR` �?`nodes` 过滤 + 两两循环都跳�?      `[data-test=action-bar]` 子树；该区域几何改由 spec 断言专项�?      （双视口三键无边�?无底�?仅数�?热区�?0、移动端 fixed+贴底+
      发丝线、桌�?static+与标题左缘对�?在评论区之下+正文17/标题24）�?      `auditPage` 终态等待对 `#/note/` 追加�?`action-bar` 出现
      （v-else-if=note，量早了 `spec.keys` �?undefined 会假红）�?    - **ui-layout-audit �?finally 吞错隐患（本轮真踩）**：`main()` 原来
      没有 catch，中途异常会穿过 `finally` 里的 `process.exit(0)` —�?      跑到 22 条就停却报�?2/22 通过」。已�?`crashed` 标志：异常打�?      且以�?0 退出。看到断言数明显少于预期先怀疑这个，别信全绿�?    - 验收�?280 两张截图（顶部两栏、滚到底的操作栏落位）读图核对，
      诊断脚本用完即删�?- **v1.2 之后的第四轮 —�?详情页按「规格」重�?*（用户连否三轮后�?*流程
  修正**，不是又一轮微调）：CDP 269 �?**300**（ui-note 60�?4 +14、layout
  46�?3 +17），契约�?355（断言内容改了一处）。前几轮的教训：都在**�?*位置
  （吸�?�?右栏缩进 �?整卡通栏，被连否三次），根因�?*没写规格**。这轮先量�?  再定规格、最后把规格变成断言�?  - **量出来的真问�?*（`ui-layout-audit.mjs --report`，不是观感）�?    手机输入�?pill 只剩 242px、扣掉给发表按钮让位�?56px �?**170px �?10 �?    汉字**；发表钮 **54×30**（热区不�?40）；桌面吸底�?**1120px** 通栏而正文栏
    只有 **648px**；主题切换钮�?*空心�?*（`van-icon` �?`::before` content �?    `none`）�?  - **空心圆根�?*：`ThemeToggle` 用的 `sun-o` / `moon-o` **�?Vant 4.10.2 �?    259 个图标里不存�?*。`van-icon` 找不到对�?class 就只渲染一个空 `<i>`�?    外面 40px 的圆还在 —�?看截图才发现。已换成真实存在�?`bulb-o` / `circle`�?    并给 layout 加了**全站扫描断言**：`i.van-icon` �?`::before` 必须非空
    �? �?× 2 视口 = 12 条）�?*写图标名前先�?`vant/lib/index.css` 里有没有
    `.van-icon-<name>` 规则**，别凭印象�?  - **两行吸底�?*：`.actionbar` 基础样式 `flex-direction: column`。行1 输入
    胶囊**通栏**�?30 �?406px，`padding: 11px 16px`），�? 左「发表�?4×44
    圆形图标钮（`van-icon name="arrow"`）、右三键 44×44 键距 12�?    **DOM 要动**：`.c-send` �?`.input-row` 搬进新的 `.bar-actions` �?—�?    原来它绝对定位压在胶囊右下角，只�?`padding-right: 56px` 让位，�?56px
    恰好等于按钮宽度，textarea 超过 `max-height` 内部滚动后滚出来的行直接
    走到按钮底下（用户说�?输入时遮�?）。搬出来让位就不需要了�?  - **栏高不写�?*：`ResizeObserver` 监听 `.actionbar` 高度写进 `--bar-h`�?    `.page` �?`padding-bottom: calc(var(--bar-h, 112px) + var(--kb-inset, 0px))`�?    输入框是 `field-sizing: content` 多行自增的，栏会�?112px 长到 188px�?    写死 76px 必然在打字时盖住最后一条评论�?  - **软键盘遮挡（headless 验不了，只能真机�?*：`index.html` �?viewport �?    `interactive-widget=resizes-content`（Android Chrome 键盘弹起时收�?    layout viewport，fixed 栏自动落到键盘上方）；iOS Safari 不认这个键，由新增的
    `src/composables/useKeyboardInset.ts` �?`visualViewport` �?    `resize/scroll` �?`--kb-inset` 兜底�?*headless Chrome 没有软键盘，这条
    只能让用户在真机�?*�?  - ⚠️ **「吸底栏�?padding 不抬升」是个真缺陷�?026-10-04 已修**：原�?    `--kb-inset` 被当吸底栏的**内边�?*（`padding-bottom: calc(8px + var(--kb-inset))`），
    于是 �?`--bar-h` �?ResizeObserver �?`offsetHeight` 得到的，**已经含键盘高�?*�?    �?`.page` �?`padding-bottom: calc(var(--bar-h) + var(--kb-inset))` 又加一�?    �?键盘一开页面末尾就有**�?2 倍键盘高�?*的死空白；② 栏本身被撑成
    「键盘高 + 112px」，靠那截空白把内容顶到键盘上方，位置碰巧对、机制是错的�?    现在改成 `bottom: var(--kb-inset, 0px)`�?*只用来抬�?*），`padding-bottom`
    换成 `calc(var(--xk-space-2) + env(safe-area-inset-bottom, 0px))` —�?顺带补上
    safe-area，TabBar �?`.page` 一直有、吸底栏漏了，刘海屏上键盘收起时按钮会压�?    Home 指示条。两条路径互不干扰：Android 收缩 viewport �?inset=0 �?`bottom:0`
    正好在键盘上方；iOS 不缩 �?inset=键盘�?�?抬到键盘上方�?  - **headless 验不了「触发」，但能验「消费机制�?*：往 `main.page` 上注�?    `--kb-inset: 300px` 就能验算术与 CSS�? 条断言钉死（ui-note 3 �?+ ui-interaction
    4 条）：栏底边�?300px 到视口底之上�?*栏自身高度与 `--bar-h` 不变**（← 双算
    回归钉子）、`.page` �?padding = 栏高 + 300、滚到底最后一条评论完全露在栏之上�?    键盘收起后归位。另�?2 条静态断言�?`index.html` �?viewport meta
    （必须有 `interactive-widget=resizes-content`，且不许锁缩放）�?    **唯一仍需真机�?*：`useKeyboardInset` 的触�?—�?iOS Safari 弹键盘时
    `visualViewport.height` 是否真的变小。那是浏览器行为，代码只能响应；
    修完之后即使触发时序有偏差，最坏也只是栏位置差一点，不会再出�?600px 死空白�?  - **两个栏容�?`.col-media` / `.col-text`（第六轮，用户明确要求后才改对）**�?    - **用户原话**：「网页端的评论放到照片下面，不然展开长文就会移动评论。移动端�?      照片放到全文上面。」—�?之前那版把评论塞进右栏正文下面，**行为正好相反**
      （正文一变长评论就被推下去），这一版才落实�?    - 桌面（≥1024）：`.card` 是两栏网格，**两个容器各占一列、各自独立堆�?* �?      �?= 图片 �?评论 �?操作栏；�?= 作�?�?标题 + 正文（作者在最上面、标题与正文相邻）�?    - **为什么必须是两个容器、不能一个网格逐个 `grid-column`**：网格的**行是跨栏
      共享�?*。评论若放第 1 栏第 2 行，这一行的起点是「图片高」与「标�?作者高�?      的较大值，评论就被推下去了。分成两栏容器后行高互不影响 —�?实测
      **展开长文前后评论 `top` 都是 769，�?0**（ui-note 有断言钉住）�?    - 移动�?1024）：两个容器 `display:contents`，`.card` �?`flex column`�?      �?`order` 排出 `图片1 �?标题2 �?作�? �?正文4 �?展开5 �?评论6`�?      **一�?DOM 出两种排�?*，因为桌面要的顺序与移动�?*互不相同**，单一 DOM
      顺序满足不了两者�?    - 顺带**拆掉了整套图片绝对定位机�?*（`--media-h` / `min-height` /
      `align-content: start` / 图框 `position:absolute`）：那套�?P12-C 为了
      「评论进右栏、图片列不撑高」才加的，现在图片只是左栏普通流里的一块，
      高度�?`aspect-ratio` + `max-height:72vh` 决定就够了�?    - `:style="{'--img-ratio': ...}"` 仍留�?`<article>` 上（两栏都要继承它）�?  - **长正文折�?*（不做内嵌滚动框：滚动链、Ctrl+F 搜不到、手机像 App �?App）：
    `.content.clamped` �?`-webkit-line-clamp`，移�?8 �?/ 桌面 12 行，
    配「展开全文」按钮（`aria-expanded`）�?*溢出检测必须在折叠态量**
    （`scrollHeight - clientHeight > 4`）：展开后量会得到「没溢出」�?    按钮自己消失 —�?�?`measuring` 标志临时强制折叠一次，量完恢复�?    �?`display` 值是错的：Chrome �?`display: -webkit-box` 归一�?`flow-root`�?    断言要断 `webkitLineClamp`�?    ⚠️ **测「展开后评论不动」的长正文必须是 20 �?*：桌面阈�?12 行，12 段刚�?    被装�?�?不溢�?�?展开按钮**合理地不渲染**，断言会拿�?null�?  - **评论字数 500 �?1000**（对齐小红书真机，用户嫌 500 太短）：
    `comment.content` �?**VARCHAR 不是 TEXT**，改上限必须四处同步 —�?    `sql/schema.sql` 列宽、`CommentCreateDTO` �?`@Size`、前�?`COMMENT_MAX`�?    `contract-test.mjs` �?`'�?.repeat(1001)` 断言。现有库要手�?    `ALTER TABLE xiaoku_db.comment MODIFY COLUMN content VARCHAR(1000) NOT NULL`
    （`sql/schema.sql` 挂在 `/docker-entrypoint-initdb.d/`，只在新库初始化时跑）�?    计数器改�?*�?80% 才出�?*（常�?`12/500` 纯噪音）�?  - **配色**（新�?token `--xk-amber-text`，按主题给值）：单一颜色�?    「白底要够深、暗底要够浅」之�?*无解** —�?白底要求相对亮度 �?.161
    �?.5:1），`--xk-surface` #4e5478 要求 �?.594。所以浅色给 `#8a5a00`
    （压白底 5.93:1）、深色给 `#f5cd7a`（压 #4e5478 4.86:1）�?    发表钮从硬编�?`#f5a623` + 白字�?*2.03:1**）改�?`--xk-amber` +
    `--xk-amber-ink`�?.69:1，与 `.xk-btn` 同一套）�?  - **热区**：三键与发表 44×44；关�?编辑/下架/删除 28�?0；SiteNav 品牌/搜索�?
    搜索按钮 38�?0。layout �?*热区扫描断言**第一次跑就抓�?`brand 125x38`�?  - **layout-audit 的登录加重试**：login �?IP 限流 60/min，全量连跑时前面 8 �?    刚把桶用掉，layout 登录会吃 429，表现为「超时：登录成功」（登录请求返回错误�?    页面根本没跳走）。已改成撞了就等 20s 重试，最�?3 �?—�?**看到这个超时�?    怀疑限流，别当布局回归**�?  - **验收**�?30 / 1280 各两张截图读图核对（移动吸底两行、桌面右栏评论区+
    两行操作栏、主题钮有字形）�? 个临时诊断脚本（`_shot` / `_diag-theme` /
    `_diag-icon` / `_check-icons`）用完即删�?- **v1.2 之后的第五轮 —�?移动端导航缺�?+ a11y/交互审计整改**，CDP 300 �?**388**
  （smoke 26 / refresh 8 / note 77 / profile 26 / interaction 51 / follow 25 /
  search 19 / idempotent 9 / layout 108），契约�?**355**（本轮后端只改了评论
  字数上限那一处，已单独验过）�?  - **根问题：移动端整层导航不存在**。`SiteNav` �?`�?024px` �?    `display:block`，`<1024` 时移动端每页只有自己�?`.top`（品�?返回），
    想去「关�?搜索/我的」必须退回首页再点进去。新�?    `src/components/TabBar.vue`：底部固�?5 项（首页 / 关注 / **＋发�?* /
    搜索 / 我的），发布凸起居中�?4×44 琥珀圆钮），激活�?`--xk-amber-text`
    + `aria-current="page"`，点当前 tab 回顶部�?    - **图标名必须先�?`vant/lib/index.css` 有没�?`.van-icon-<name>` 规则**�?      `home` 不存在、`home-o` 才是（同 `sun-o`/`moon-o` 那次）�?    - **详情/编辑/发布/登录页刻意不�?*（`HIDDEN_ROUTES`）：详情页已有自己的
      吸底操作栏（z 60），两层 fixed 元素叠一起既挤又抢焦点�?      ⚠️ 这里的路由名必须�?`router/index.ts` �?`name` 逐字一致：详情页是
      **`note-detail` 不是 `note`**（写错过一次，症状是详情页底部同时出现
      操作�?+ tab 栏）�?    - **留白跟着实际可见性走**，不写死 56px：`TabBar` �?`watchEffect` �?      `<html>` �?`data-tabbar="on"`，`main.css` �?      `@media (max-width:1023px) html[data-tabbar='on'] .page { --xk-tabbar-h: 56px }`
      消费。写死的话登�?发布/编辑/详情四页会凭空多出一段空白�?    - 断点�?CSS 媒体查询管，组件**不监�?resize**（监听会让「改窗口大小�?      标记过期」这�?bug 回来）�?  - **装了 Vercel �?`web-design-guidelines` skill**（全局
    `~\.agents\skills\web-design-guidelines`）。⚠�?装完要改 SKILL.md 里的
    guidelines URL：原地址�?`raw.githubusercontent.com`�?*这台机直连与
    127.0.0.1:7897 代理都超�?*，WebFetch 每次拉取都会失败；换�?    `cdn.jsdelivr.net/gh/vercel-labs/web-interface-guidelines@main/command.md`
    实测可取�?*但要说清：它�?a11y/工程卫生清单，不含任何尺寸与位置规则** —�?    「大小不对、位置不对」它治不了，那部分靠规格 + 断言�?  - **审计整改（已修）**�?    - 触摸交互：`touch-action: manipulation` + 低透明度品牌色 tap 高亮
      �?*不用 transparent**，直接透明会让点按毫无反馈，比闪白更难点准�?      更不能顺手写 `user-scalable=no`），弹层�?`overscroll-behavior: contain`�?    - 11 处表单控件补 `aria-label`（`ProfileView` 昵称框此�?*�?placeholder
      都没�?*；三个搜索框只有 placeholder）�?    - 时间�?`Intl.DateTimeFormat`（新 `src/utils/datetime.ts`），替换两处
      `createTime.replace('T',' ').slice(0,16)`。⚠�?后端�?*无时区的
      `LocalDateTime`**，`new Date('2026-10-01T16:40:00')` �?ES2015 规范�?      **本地时间**解析，不会发生时区偏移；**不要**�?`'Z'`�?    - 未保存提醒（�?`useUnsavedChanges.ts`）：`onBeforeRouteLeave` �?Vant
      确认�?+ `beforeunload` 拦刷�?关页；发�?编辑提交成功�?`markClean()`�?      ⚠️ `beforeunload` 会让 CDP �?`Page.navigate` **卡住等原生对话框**，所�?      `ui-cdp.mjs` 里注册了 `Page.javascriptDialogOpening` �?自动
      `Page.handleJavaScriptDialog({accept:true})`�?    - **18 处导航改 `RouterLink`**（卡�?`.main`、作�?`.author`、SiteNav
      品牌 + 4 个导航、关�?粉丝/去发�?我的、编辑、返回首页）�?*3 �?      `router.back()` 保持 `<button>`** —�?它是历史动作不是 URL 导航，规则本�?      就要求动作归 button�?*12 处脚本内 `router.push/replace`**（表单提交后跳转�?      守卫重定向、列表分支）也不动。`<a><button>` 是非法嵌套，所以卡片主体与
      作�?关注按钮必须保持**兄弟节点**�?    - 6 处静态图�?`width/height`（头�?62/40、logo 36、吉祥物 168）；
      **封面图与文字卡预览刻意不�?* —�?它们�?`aspect-ratio` 盒子占位�?      CLS 已被挡住，机械写属性反而会写进错误的值�?    - 打磨：`SiteNav` 去掉 `:focus-visible { outline: none }`（全局焦点环本�?      就在，之前被自己打掉了）；`h1,h2 { text-wrap: balance }` 防孤字；
      计数类加 `tabular-nums`�? �?placeholder �?`…`；用户名/昵称�?      `spellcheck="false"`、昵�?`autocomplete="off"`�? 个视图的错误段落�?      `role="alert"`；品牌名�?`translate="no"`�?    - **有意保留**：轮播的 `transition: aspect-ratio/height/min-height` 违反
      「只过渡 transform/opacity」，但那张静止图�?0.25s 平滑�?P12 �?      「图列不再撑出大空白」那套机制的手感来源，改成瞬变会明显跳变。代码里
      写了注释说明取舍�?  - **测试基建的三处整�?*（都是被这轮的真实故障逼出来的）：
    - **登录抽成公共 `loginDemo(s, base, {attempts, onFilled})`**（在
      `ui-cdp.mjs`）：这段「goto �?�?.demo �?�?.xk-btn �?�?hash」原本在
      **8 个文件里各抄一�?*，同一个坑要踩 8 次。带 20s × 3 次重试；重试�?      **先判断是不是已经在首�?*（首次可能服务端已登录成功、只�?SPA 跳转慢，
      此时�?goto `#/login` 会被 `guestOnly` 守卫弹回，`.demo` 永远不出现）�?    - **布局审计的「加载终态」超时不再静默吞�?*：以前是 `.catch(() => {})`�?      于是「关注流还没回来」会被当成「关注流是空的」继续量，最后报�?      `cols=undefined` 这种看不出根因的假红。现在把结果带回 `auditOne`�?      显式断言「进了终态」（超时就是超时）。顺带把等待�?10s 放宽�?20s�?      骨架选择器从 `.page` 改成 `.page, .login`（登录页根元素是 `.login`）�?    - `ui-search` 的「搜不到」关键词从写死的 `绝无此词zzz999` 改成**每轮随机
      拉丁�?*：`ik_smart` 把中文拆成单�?+ `multiMatch` 默认 **OR**，所�?      「绝无此词zzz999」会被拆�?�?�?�?�?zzz/999，库�?*任何一�?*�?      「无」「词」「在」的笔记都会命中（实测撞�?`xiaoku_demo` 那篇标题「空格�?      的笔记，`total=1`）。这�?AGENTS.md 17.4 记的是同一个坑�?  - **环境导致�?flake（本机实测，别当代码回归�?*：内存只�?1.1GB（用�?    Chrome 16 进程 + dev �?6 容器 + **prod �?7 容器**同时在跑）时，冷启动�?    **第一个请求能�?9s**，随�?366ms。撞上过：关注流「请求超时」、注册按�?    挂起 >5s、登录「网络异常」、轮播轨道偶发未位移。对应处理：注册与幂�?    改成 `waitFor` 而不是固�?sleep；轮播轨道位移改轮询等它真的动；
    登录走公共重试�?*全量连跑之间建议�?45~90s**，否�?demo �?    login 60/min �?publish 20/min 会被前几组用光�?- **仍未修的已知缺陷**：`--xk-text-3` �?meta/label/计数对比�?�?.5 低于 WCAG AA�?  牵连全站每一页的视觉，本轮刻意没�?—�?要动得单独一版给你看�?  **搜索仍是 OR 语义**：`ik_smart` 单字 + `multiMatch` 默认 OR，导致搜
  「绝不存在」会命中任何含「存」「在」的笔记。改 `operator: AND` 能收紧召回，
  属于产品口径变更，没擅自改�?  ⚠️ **这条已于「搜索召回收紧」一轮改�?*：现在用
  `minimumShouldMatch("50%")`，不�?`operator: AND`。实测（库里 163 篇）�?
  | 关键�?| OR（旧�?| AND | msm50（现�?|
  |---|---|---|---|
  | 绝不存在zzq998 | **28** | 0 | **1** |
  | 书桌上的三盏�?| **31** | 1 | 9 |
  | 通勤穿搭 | 3 | 1 | 1 |
  | 点赞 | 33 | 27 | 33 |
  | **毛球喵社** | 2 | **0** �?| **2** |
  | TCC 典型应用场景 / 折叠 / 发现 | 1/3/1 | �?| �?|

  **别改�?AND**：ik_smart 切出�?token 数与命中数经常对不上，「毛球喵社」这�?  品牌词会被判�?0 结果（表格里 AND 那一列唯一倒退的就是它）。用 `"50%"` 而不�?  固定整数 2：token 少时 50% 向下取整�?0，短词不会被误杀�?  契约 16.x 有两条钉住它：中文乱�?`total �?3`（防太松）、中文实�?`total > 0`
  （防太紧）。两条都**不钉具体数字**（库里还有种子号/演示�?压测残留）�?
### P3 已知缺口（不是遗漏，是当前阶段做不到�?
- **草稿（status=0）分支仍没有创建入口**：下架（status=2）自 P10 起有接口可造，
  门禁已被契约 17.2 覆盖；但「投稿即草稿」的创建路径后端刻意不做，只有管理端
  做出来才能造出 status=0 数据。`NoteQueryServiceImpl` 里它的判断分支仍未实测�?- **`S3ImageStorage` 未实�?*：本机没�?S3 端点，只验证�?`type=local` 分支�?  代码能编译但没跑过真实请求，别当成「已验证」�?- **笔记详情需要登�?*：`/api/note/{id}` 带路径变量，无法�?`MvcConfig` �?  精确匹配白名单放行；改前缀匹配会同时让发布/上传的语义变模糊�?  保持「默认全部需要登录」，取舍写在 `NoteQueryServiceImpl` 的注释里�?- **`bio` 清空后回不到 `NULL`**：MyBatis-Plus 配的�?`update-strategy: not_null`�?  只有 `null` 会被剔除，`''` 会真的写进去。所以「不传字段」和「传空串」语义完全不同：
  前者是保持原值，后者是清空。改资料�?`bio` 必须无条件提交，别写
  `if (bio) patch.bio = bio`（那会让用户永远清不掉简介）�?  推论：`bio` 一旦是 `''` 就再也回不到 `NULL`�?
### P5 已知缺口（不是遗漏，是当前阶段做不到�?
- **「下架笔记上取消点赞/收藏」会连带回滚**：`NoteInteractionServiceImpl.unlike`
  删关�?+ 减计数之后调 `getDetail`，对 `status != 1` �?20002�?  `@Transactional` 把已成功的删除一起回滚。注释里写清了来龙去脉，
  要修得给「非本人可见的未发布内容」造一个内部旁�?—�?牵扯「路人有没有�?  在取消时读到草稿」的权限语义，留到做管理端时一并定�?  目前 P5 没有下架/编辑接口，这条分�?*造不出来也没测过**�?- **契约测试只验 HTTP 报文，验不了前端封装�?*：`get(url, params, config)`
  写错（把 `{ params: {..} }` 塞进 params）契约测试照样全绿，
  只有真机 CDP 才炸（已踩，见第 6.2 节）。改 `request.ts` / `api/*` 必须�?CDP�?- **评论�?`comment_like` 只读不写**：回填了 `liked` 字段、schema 里有表，
  �?P5 没有评论点赞接口，前端也用不�?—�?别以为它「已经实现」�?- **S3ImageStorage 仍未实测**（同 P3，本机无 S3 端点）�?- **固定账号 xk_ui_interact**：`ui-interaction.mjs` 的常驻评论者，
  �?`10003` 判通过，和 `xk_ui_smoke` 一�?*不要清理**�?
### P7 已知缺口（不是遗漏，是当前阶段做不到�?
- **没用 IK 中文分词**：`NoteSearchDoc` 用的�?ES 默认 standard 分析器，
  中文基本按单字切，召回够用（「笔记」能搜到）但语义相关性远不如 IK�?  要换就改注解上的 `analyzer` + �?IK 插件，重建索引。（<b>P10 已实�?/b>�?  见上�?P10「IK 中文分词」段，此条保留仅作历史记录。）
- **`createTime` �?Long �?epochMillis �?WARN**：`@Field(type = Date, epoch_millis)`
  �?`Long` 会被 Spring Data ES 判为不支持类型，实际落成 number 字段�?  排序（`SortOptions.of` �?createTime desc）和检索都正常，但映射不是日期类型�?  将来做时间范围查询要注意写法�?- **点赞/收藏/评论计数不触发重建索�?*（决�?D2）：卡片计数在回 MySQL 时现查，
  所以展示值是准的；ES 里的 `createTime`/标题快照不会随编辑更�?—�?  �?P3 至今没有编辑/下架接口，所以暂时没有漂移来源�?  真正要做的是 P8 �?Redis 计数 + 异步落库�?- **reindex 是全量重�?*：删索引 + �?MySQL 回灌�?0 篇就 10 篇，量大了会慢，
  且期间检索会短暂失败。没做增�?双写，别在生产直接调�?
### P14 发现流已知缺�?
- **P14 发现流已完工**（本 commit）：`GET /api/feed/discover` + 首页两个 tab�?  契约 **378 �?*�?55 + 23�?7.5 段）+ CDP **368 �?*�?58 + 10�?  - **排序三级**（`FeedMapper.pageDiscover`）：`EXISTS(我关注了作�? DESC`
    �?`(like_count+collect_count+comment_count) DESC` �?`create_time DESC,
    id DESC`。发现流**排除自己发的**（`n.user_id <> ?`）�?  - `authorFollowed` **不再写死 true**：`FeedServiceImpl` 抽出公共
    `assemble(notes, total, page, size, viewerId)`，两个流都用
    `UserFollowQueryService.batchFollowingIds` 实时判断。关注流原来�?    「能出现在关注流�?= 已关注」推断，作者被逻辑删除�?`findUserVOMap`
    会缺条目；发现流更是混着已关注与未关注两种作者，必须实时算�?  - 前端：`activeTab` 默认 **`discover`**、`switchTab()` 换接口，
    tab �?`<button role=tab>` + `aria-selected`（切 tab �?*动作**不是 URL
    导航，规则：导航�?a、动作归 button）；两个空态文案分开�?  - **连带必须改的测试**：`ui-follow` 进首页后�?*先点「关注」tab**再等
    `feed-item`，否则整组挂在「feed 出现测试笔记」上（素材笔记不在发现流里）�?    `ui-smoke` 的昵称断言从首�?`.nickname` 改到「我的」页 `[data-test=me-nickname]`
    —�?首页资料�?`display:none` �?`querySelector('.nickname')` **照样找得�?*
    （display:none 不出 DOM），断言会「通过」但验的是用户看不到的东西�?  - CDP 17.5 段刻�?*不钉 total 的具体数�?*（库里还有种子号/演示�?压测残留�?    写死数字每加一次种子数据就得重写断言），钉的是「集合关�?+ 排序规则」：
    不含自己、全 `status=1`、`authorFollowed` 是布尔、已关注连成前缀�?    同档内互动量非递增、`size` 夹取、关注流回归�?
### P14 发现流已知缺�?
- **`ORDER BY` 全靠 filesort，没有索引支�?*：`pageDiscover` 的排序键�?  `EXISTS(子查�? DESC, (like_count+collect_count+comment_count) DESC,
  create_time DESC, id DESC`。前一个键是子查询结果、第二个是三列之和，
  **都无法进索引**。prod 库上 EXPLAIN 实测�?  `Using filesort` + `DEPENDENT SUBQUERY`（每个候选行跑一�?EXISTS�?  �?`uk_user_follow` �?eq_ref，单次便宜但逐行执行）�?  **形状不对 �?现在就有问题**，所以配了两个可复用脚本量过（见下）�?
- **发现�?vs 关注�?实测�?026-10-04�?00 篇数据集 / 8 并发 / 每目�?400 请求 /
  0 失败，`deploy/loadtest/feed-bench.mjs`�?*�?
  | 目标 | p50 | p95 | p99 | max |
  |---|---|---|---|---|
  | discover p1 | 24.6 | 80.5 | 245.0 | 349.7 |
  | discover p5 | 26.6 | 97.1 | 285.2 | 366.1 |
  | discover p25 | 27.8 | 97.0 | 266.0 | 396.4 |
  | follow p1 | 14.0 | 48.3 | 151.1 | 313.1 |
  | follow p5 | 13.4 | 52.5 | 136.8 | 255.3 |

  **判读**：discover �?follow �?1.7~1.9×，但绝对�?80~97ms 远低于项目自己的
  p95 预算 600ms（k6 thresholds）。深页几乎不额外变贵（p5→p25 �?p95 基本持平），
  因为 filesort 的开销主要�?*行数**而不�?OFFSET�?*所以现在不�?`hot_score`
  物化�?* —�?那要付出「异步刷�?+ 漂移」的确定成本，换一个当下量不出来的收益�?  **重测的触发条�?*：笔记数 > 5000，或 discover p95 > 200ms。届时再�?  `node deploy/loadtest/seed-big.mjs --authors=20 --notes=60` 加量后重测�?
- **压测脚本两个坑（都踩过，别重复）**�?  - **固定顺序量目�?= 废数�?*：每�?VU 按同一顺序�?5 个目标时，排第一的那�?    独吞�?JIT/连接�?查询缓存冷启动的全部成本。实测量�?`discover p1` 68.6ms
    �?`discover p25` 36.2ms 还慢的荒谬结果。`feed-bench.mjs` 现在先预�?15 �?    再按 VU 轮转起点�?  - **页码超出数据�?= 假深�?*：数据只�?119 篇时 `page=25`（offset 480）直接返�?    空集，耗时天然更低，看着�?深页更省"。脚本现在统计空集率，超过一半就打警告�?  - `seed-big.mjs` **必须做限流退�?*：publish �?20/min/用户，不退避时
    `--notes=60` 会静默丢�?2/3 数据�?80 篇里失败 320）而脚本只打印一行「失�?N」�?  - 造出来的 `xk_big_*` 账号/笔记�?prod 库里的残留清理见�?5 节的 SQL 模式�?    正则换成 `'^xk_big_'`�?*prod 是给人看界面的，别留着 `xkbigA8N60_1_1` 这种
    标题当演示数�?*，量完就清，要量再跑 seed�?- **互动量排序读的是 note 表的三个计数列，而它们是 Redis 权威值的异步落库产物**
  （P8 `NoteCounterFlushJob` �?30s 刷一次）。所�?*刚发的笔记会有最�?30s
  排在比它热度低的老笔记后�?*，随后自动纠正。这里刻意不逐条 `ZCARD`：一�?20 �?  要读 3 �?ZSet 的全部成员，代价远大于排序本身。这条取舍写进了
  `FeedMapper.pageDiscover` 的注释，别当 bug 反复"�?�?- **只出首页 20 条，没有翻页**：发现流与关注流都只请求 `page=1&size=20`�?  没有「上拉加载更多」。真要加得引入页码状�?+ `IntersectionObserver`�?  且注�?`OFFSET` 深分页会越来越慢（同一根因）�?- **默认 tab 是「发现�?*：因为关注流对一条关注都没有的新用户永远是空的�?  代价是已关注的老用户进首页第一眼看到的是全站流而不是关注流，得多点一下�?  这是产品取舍，不�?bug�?
### P15 通知 + 收藏 + 内容审核（本 commit�?
契约 **436 �?*�?82 + 通知 27 + 收藏�?12 + 内容审核 15），CDP **414 �?*
�?88 + `ui-notification` 26）�?
- **通知中心**：新 `module/notification/`（实�?/ 类型枚举 / Mapper / VO /
  Service / Controller）。接�?`GET /api/notification/list?onlyUnread=`�?  `GET /api/notification/unread-count`、`POST /api/notification/{id}/read`�?  `POST /api/notification/read-all`。类�?`1` 赞笔�?/ `2` 评论 / `3` 赞评�?/
  `4` 关注 / `5` 回复�?  - **写入一�?afterCommit + try/catch 吞异�?*：通知失败不该把点赞、评论�?    关注一起回滚（用户已经看到「已点赞」了，再撤销才是真的坏体验）�?  - 去重�?`uk_notify_once(receiver_id, actor_id, type, target_id)`：同一接收�?+
    同一操作�?+ 类型 + 对象只有一条；重复互动�?`UPDATE` �?`is_read` 改回 0�?    `content` 刷新�?*不动 `create_time`**（它仍是首次发生的时间，列表排序稳定）�?  - 不给自己发通知（发起点就是操作者本人）�?  - ⚠️ **`note_id` 必须允许 NULL**：关注通知没有笔记，被 `target_id`（此时是
    receiver �?userId）填进去的话，前端「去这条笔记」会跳到一篇不存在的笔记�?    `sql/schema.sql` 改成 `note_id BIGINT NULL`�?*存量库要手动 ALTER**�?  - ⚠️ **`unread-count` 返回 `Result<Integer>`，不�?`Result<Long>`**：`Long` 会被
    �?6 节的 `ToStringSerializer` 序列化成 `"0"`，而前端要的是数字�?  - ⚠️ 前端铃铛**只挂�?`SiteNav`（≥1024px）里**，移动端入口放在「我」页一行�?    最初做成全局固定铃铛�?30px 下直接压住顶栏的主题切换与返回键（实测重叠）�?  - `useUnreadCount.ts` �?*模块级单�?*：`App.vue` 在路由变化时刷新�?    `NotificationBell` / `ProfileView` 共用同一�?ref，否则两处各请求一次还�?    各自维护一份数字�?  - CDP 断言里有一�?*不能只判「元素在不在 DOM 里�?*�?    `notification-bell` 挂在 `display:none` �?`SiteNav` 内，子元素的
    `getComputedStyle().display` 仍是 `flex`（父级隐藏不改变子级计算值）�?    判「用户看不看得见」要�?*盒子面积**（`getBoundingClientRect()` 宽高�?0）�?
- **我的收藏�?*：`GET /api/note/collections?page=&size=`�?*不收 userId** —�?  收藏夹是私有数据，能�?id 就等于可越权查别人的收藏）。实现落�?  `NoteCollectMapper.pageCollectedNotes` + `NoteQueryService.pageMyCollections`�?  - 只返�?`status=1`：下架的笔记点进去会�?20002，给一条点不开的条目没意义�?    契约里有一条专门钉「下�?�?从收藏夹消失 �?上架 �?回来」�?  - 排序 `collect.create_time DESC, c.id DESC`；`authorFollowed` **实时�?*�?    不能用「能出现在收藏夹�?= 已关注」推断（收藏夹里全是别人）�?  - 前端 `/collections`，移�?2 �?/ 桌面 4 列瀑布�?
- **内容审核**：新 `module/moderation/`（`TextModeration` 接口 +
  `DefaultTextModeration` 词库实现 / `ImageModeration` 接口 + `NoopImageModeration`）�?  错误�?`CONTENT_SENSITIVE(60001)`，接�?*发布、编辑、评论三个入�?*
  （`NoteServiceImpl.validatePublishParams` �?publish/update 共用的，
  挂在里面 = 编辑改标题同样过审，否则「发的时候干净、编辑时塞进去」是后门）�?  - **词库是占位表**（`backend/src/main/resources/moderation/words.txt`�? 条）�?    上线前必须换完整词表 —�?仓库里这份只用来让链路有真实数据流过�?  - 匹配前做 **NFKC 归一 + 转小�?+ 压缩连续重复字符**：全角大写变�?    （`ＸＫ－ＳＰＡＭ－ＭＡＩＬ`）与填充重复（`地下地下地下钱庄`）都要同样命中�?    契约里有两条分别钉这两种绕过�?  - **长度 <2 的词条在读取时丢�?*：中文单字词（`钱`、`赌`）误伤率极高�?    宁可漏拦也不要把正常笔记全拦下来�?  - ⚠️ **读词库必须先 `strip()` 再判 `#` 注释**，否则满缩进的注释行会被当成词条
    收进去（首次实现�?4 条词库读成了 14 条，等于在拦正常内容）。启动日志里
    `敏感词库已加载：N` �?N 就是词条数，**数字不对先查注释过滤**�?  - ⚠️ **词库读失�?/ 缺失�?fail-open + WARN**：审核服务挂了不该让全站发不了笔记�?  - ⚠️ **60001 �?message 绝不回显命中的词**：告诉用户「你哪个词被禁」等于给�?    绕过办法（换个同义词就行）。命中的词只进服务端日志�?  - ⚠️ **评论审核最初是假绿�?*：`textModeration.check(comment.getContent(), ...)`
    被写�?`comment.setContent(...)` **之前**，那一刻实体字段还�?null�?    �?`check` �?null 直接放行。必须审 `dto.getContent()`�?    这条只有**真实调用**才发�?—�?契约 17.7 是照着「发布能拦」的直觉写的�?    先写断言就会绿�?  - **图片审核默认关闭且仓库里没有真实实现**：`NoopImageModeration` 只做一件事 —�?    在日志里说清「图片未审核」，避免有人以为这条链路已经过了风控�?    �?`xiaoku.moderation.image.enabled` �?true 只会多打一�?ERROR 日志�?  - 契约 17.7 **用独立账�?`ct_mod<stamp>`**：发布是 20/min/USER，�?    `contract-test.mjs` 全文�?`note/publish` 出现 26 次，挂在主账号上会撞桶，
    症状是某�?publish 莫名其妙返回�?0、后面整段连锁假�?    （踩过：第一次跑 427/432�? 条假红全是这一个原因）。`ct_mod` 前缀仍匹�?    �?5 节的清理正则 `^ct[0-9]?_[a-z0-9]+$`�?
### P15 已知缺口

- **通知只增不清�?*：没有「保留最�?N 条」的定时清理，`notification` 会无限增长�?  用户明确说了本轮不做（先有功能再补运维）。每跑一�?`ui-notification.mjs`
  会给 `xiaoku_demo` �?1~2 条通知，属预期�?- **通知列表没有分页**：`GET /api/notification/list` 默认 `size=20`�?  前端只取第一页，没有「加载更多」�?- **收藏夹没有分�?UI**：`/collections` 只取 `size=50` 一次�?- ~~「取消收藏」只从列表移除~~ **已修**：`CollectionsView.remove()` 现在�?  �?`DELETE /api/note/{id}/collect` 再改本地，失败时保留该条�?toast 原因
  （不做乐观更�?—�?这里的回滚就是「什么都不改」，比维护快照更不容易出错）�?  按钮在请求在飞时 `disabled` 并改文案，防连点发两次�?  CDP 那条钉住它的断言�?*「刷新后仍然不在�?*：只 `list.filter` 的实现当�?  看着是对的，断言也拦不住，只有重新进页面才拦得住�?- **审核词库是占位表**（见上），且只审文本：昵�?/ 个人简介（`PROFILE` 场景
  已在枚举里）尚未接入 `ProfileView` 的更新路径�?- **没有语义审核**：词表命中挡不住「换个说法」的违规内容，真实平台需�?  模型或第三方内容安全 API。当前实现刻意只做词表，不做假的语义判断�?
### P15 测试基建：两个「报绿但其实没跑完」的�?
这两个都是本轮真的踩到、且症状都是**「结果看起来是绿的�?*，值得单列�?
1. **`finally` �?`process.exit()` 会把异常变成「通过�?*
   （`ui-layout-audit` 已犯过一次，`ui-notification` 又犯了一次）�?   写成 `catch (e) { /* 忘了 */ } finally { const allOk = await s.close();
   process.exit(allOk ? 0 : 1) }` 时：异常穿过�?�?`close()` 把已跑过的断言
   正常汇�?�?**打印�?3/13 通过」、退出码 0**。实际只跑到一半�?   本轮的具体触发点�?`s.check(` 误写�?`check(`（ReferenceError），
   顺带把末尾的清理也跳过了，于是库里攒�?3 �?`colprobe*` 垃圾笔记�?   **规矩**：入口必须是 `try { �?} catch (e) { crashed = e } finally {
   if (crashed) console.error(�?; �?process.exit(crashed ? 1 : �? }`�?   临时数据（探针笔记之类）的清理要放在 `finally` 里、且不能只写�?happy path�?   看到断言数明显少于预期，先查这个，别信全绿�?2. **自造的用例不能假设「库是干净的」，也不能假设「第一行就是我造的那条�?*
   `ui-notification` 最初是「读-all �?造一条通知 �?点第一行跳转」。两处都脆：
   通知**跨轮累积**（`xiaoku_demo` 已有 50 条历史通知），第一行未必是这次点赞
   产生的那条，点它会跳到别的笔记，然后 `waitFor` 永远超时�?   而点赞如果上一轮崩在清理之前就一直是「已赞」状态，PUT 返回 30001�?   **本次根本没有新通知**（当时那条断言写成 `code===0 || code===30001`
   判通过，把这个问题盖住了）�?   修法：① 用例开�?`DELETE /like` 复位（幂等，返回码不用管）；
   �?点赞必须断言 `code===0`，别�?30001 当通过�?   �?定位那一行用**笔记标题**匹配，不�?`:first-child`�?   **断言里写「A 或错误码 B 也算过」要非常小心 —�?那往往是在给自己的
   测试不稳定性开口子�?*


### P16 「谁赞了 / 谁收藏了」（�?commit�?
契约 **457 �?*�?36 + 21�?7.8 段），CDP **424 �?*�?14 + 10，ui-interaction）�?
- 接口 `GET /api/note/{id}/likes` �?`GET /api/note/{id}/collects`，都返回
  `PageVO<FollowUserVO>`。数据本来就�?`note_like` / `note_collect` 表里�?  P5 只做了计数方向，这次补上反向查询 —�?**计数和名单是两件�?*�?  计数只给人一个数字，名单才带来社交感�?- ⚠️ **可见性门禁抽成了 `NoteQueryServiceImpl.requireVisible(noteId, currentUserId)`**�?  �?`getDetail` 共用同一份实现。这两个端点也是「这篇笔记的读取入口」，
  各自写一份门禁迟早漏一处，结果就是「下架的笔记正文打不开、但点赞人列�?  能拿到昵称头像」，等于门禁只做了一半。契约里两条专门钉这个�?- 刻意**不提�?*「某人的整个收藏夹」查询：收藏夹是私有数据，对外暴露等�?  允许越权遍历他人收藏（P15 收藏夹的接口因此不收 userId）�?- 分页在控制器�?`safePage / safeSize` 夹取（controller 已有 4 个分页端点，
  逐个重复 `Math.min(Math.max(...))` 只会抄错一次）�?- 前端**复用 `FollowListView`**，靠**路由�?*区分四种模式
  （follow / fans / likes / collects），而不是靠参数�?—�?后两者按笔记查�?  前两者按用户查，路径参数都叫 `id`，靠参数名区分迟早在某页�?noteId
  �?userId 传过去。列表与加载态都挂了 `:data-mode`，四�?CDP 断言靠它区分�?- 入口**没有**做成吸底三键的一部分：三键是「点了就切换状态」的动作按钮�?  再塞一个「点了就跳页」的行为进去，同一控件两种语义，`aria-pressed` �?  导航互斥，键盘和读屏都讲不清。所以另外起一行文字链�?`.interacts`
  （`note-likes-link` / `note-collects-link`），计数�?0 时整行不渲染�?- 两个踩过的点�?  - `get()` 返回的是 `{ json, ... }` �?*不是响应体本�?*。契约里漏写
    `.json` �?`p1?.data?.list?.length` 拿到 undefined，症状是「分页断言
    说拿�?undefined」，看不出是参数没生效还是取值写错�?  - �? 人赞过」这条断言必须�?like=1 的时刻做（ui-interaction 里就是刚
    点完赞那两行之间）。写成「发布后立刻断言」会拿到 0，然后断言永远红�?- **契约注册频率�?10/min/IP**：连着跑两遍契约，第二遍会在第一个注册就
  100005 失败，然�?*整份文件连锁假红**（实�?323/456，几百条全红但没一�?  与代码有关）。看到大面积失败先确认是不是这个，隔 90 秒重跑�?
### P17 话题 + @提及（本 commit�?
契约 **488 �?*�?57 + 31�?7.9 段），CDP **435 �?*�?24 + 11，ui-note）�?
话题是小红书内容组织的骨架：没有话题，笔记之间就是孤岛，搜索只能靠关键词撞上�?
- **三张新表**：`topic` / `note_topic` / `note_mention`。表结构变更�?*存量库要手动�?*
  （`sql/schema.sql` 只在新库初始化时跑）�?- `uk_topic_name` �?`INSERT IGNORE`�?*不靠「先查再插�?*：两个用户同时发�?咖啡」，
  先查后插会让两个事务都查到「不存在」然后都�?insert，第二个撞唯一索引异常一路冒�?  接口变成 500。竞态收�?SQL 内部，谁先插成功另一个静默跳过�?- `note_count` **不落�?*，查询时子查询现算。话题表本身很小，一�?20 行的关联统计
  比维护一列异步计数简单且不会漂移 —�?真问题不是「算得准不准」而是「为它付出多少」�?- 接口 `GET /api/topic/list`（热门榜）与 `GET /api/topic/notes?name=`（话题页）�?  话题�?*带不�?# 都认**（页�?URL �?# �?fragment，两边都得支持）�?  不存在的话题�?`70001` 而不是空列表 —�?空列表在页上和「这个话题还没内容�?  长得一模一样，用户会以为自己被吞了内容，真因是拼错了名字�?- `ErrorCodeEnum` 新增 `TOPIC_NOT_FOUND(70001)`、`NotificationType` 新增
  `MENTION(6)`。通知在发�?编辑成功后发，与其它通知一�?afterCommit + 吞异常�?
**`#话题` 的正则必须排除中英文标点**（实测出来的）：

```
#([^\s#@\uFF0C\u002C\u3002\u002E\u3001\uFF1B\u003B\uFF01\u0021\uFF1F\u003F\uFF1A\u003A]{1,20})
```

正文「还有一�?#很长很长的话题名字」如果允许逗号，会解析出「很长很长的话题名字�?*�?*�?这种把标点和后半句一起吞进去的话�?—�?用户完全没意识到自己建了个含逗号的话题，
而话题页会按这个名字聚笔记�?*不排�?* `- _ ~ /` 等连接符�?因为�?iPhone」�?618大促」�?C++」是真实存在的写法�?
- 关系�?*全量替换**（删旧插新）而不是增�?diff：编辑本就是全量覆盖语义�?  行数很少（一篇最�?5 话题 10 提及），删了重插最不容易出「改了正文还挂着旧话题�?  的残留。删笔记时也要清（无外键不级联）�?- **前端与后端各有一份解析正�?*（发布页的输入预览）。不共享：后�?Java�?  前端 TS，共享要靠「后端下发规则」或改语言，代价远大于收益。但两处都写�?  「改一处要同步另一处」的注释，否则两边漂移的症状是「输入时看见话题�?  发布后详情页没有」�?
四个踩过的坑（都写进了契�?17.9）：

- `@提及` 渲染成链接，**昵称和用户名都要建表**。正文里写的�?`@xk_ui_follow`（用户名），
  �?`NoteMentionVO` 原本只回 `nickname`「关注搭子」，拿昵称去正文里找**找不�?*�?  于是整段渲染成纯文本 —�?�?*界面看不出任何异�?*，只是那一段不会跳而已�?  现在 VO 两个字段都给�?- `TOPIC_PATTERN` 里写中文标点字面量会因源码编码问题变成乱码并**静默失效**�?  改用 `\uXXXX` 转义。同一个正则前端也要同步�?- 发布页改值必须走**原生 setter + 派发 input**：直�?`el.value = x` 不触�?  Vue �?v-model，预览是 computed，界面不更新。而直接调 setter 而元素不存在�?  报的�?`Illegal invocation`，与「找不到输入框」毫无关系�?- 话题段末�?*不能删掉那篇笔记就完�?*：后面几十条断言全都量它的详情页 DOM�?  直接删，之后每条 waitFor 都超时，最终报出来的是
  「getComputedStyle: parameter 1 is not of type Element」，与真因隔了整屏�?  所以要重新发一篇把浏览器停回详情页�?
⚠️ **本轮抓到一个与话题毫无关系的问�?*：插入「话题关系行」时，编辑器把上一�?ES 事件的注释和**它下面那�?`registerAfterCommit(ACTION_PUBLISH, ...)`** 一起当�?注释的延续删掉了。结果是**发布不再�?Kafka 事件**，而接口照常返�?200 —�?只有契约里「发布后�?Kafka 异步入搜索索引」那条红。它是唯一发现这件事的地方�?**教训：往一段代码中间插东西时，先确认下一行不是被误删的候�?*�?「插入式改动」最危险的失败模式就是它顺手删掉了紧随其后的语句�?
⚠️ **契约测试自身的两个结构性问�?*（本轮花了不少时间才定位）：

1. **跨段共用的可�?ID 是这类大文件测试的固有风�?*。全局那个 `noteId` �?P5 �?   末尾就被 DELETE 掉了，�?14 段的自评�?7.1 编辑�?7.2 上下架都在用�?—�?   于是从某个版本起 14 段开始整段假红（20001 笔记不存在），后面几十条连锁失败�?   症状极具迷惑性：最先看到的是「作者可以评论自己的笔记」失败，
   而「自评被放开」这个功能跟它八竿子打不着�?   **规矩：新增用例一律自建数据，不复用前面段留下什么�?*
2. **改这个文件时必须守住三条不变�?*，否�?JS 会静默变成另一个程序：
   �?全文花括号净�?= 0；② `main()` 体内「深�?2�?」的出现次数不变
   （HEAD 基准�?8，多一次就说明有个块提前闭合了）；�?`node --check` 通过�?   本轮有一次「把复原语句插到块闭合之后」，`oldNoteId` 直接变成 undefined�?   �?*语法完全合法** —�?只看语法检查发现不了�?### P18 举报 + 黑名单（�?commit�?
契约 **529 �?*�?20 + 9�?8.1 段），CDP **443 �?*�?35 + 17，ui-follow：follow 26�?3）�?
有了内容审核词表之后为什么还要这两张表：**审核只能在发布那一刻拦一�?*�?词表也可能漏。真实社区的兜底是「用户举�?+ 人工处置」，没有举报入口�?违规内容只能靠运营每天翻数据库捞�?
- **两张新表**：`report` / `user_block`。表结构变更�?*存量库要手动�?*�?
## 举报 = 公共治理，黑名单 = 私人屏蔽

这两个是同一个问题的两面（同一个举报弹窗里通常带「同时拉黑」）�?�?*性质完全不同**，混着实现会让人以为它们是一套机制：

| | 举报 | 拉黑 |
|---|---|---|
| 是否通知对方 | 是（作者收到「内容被举报」） | **�?* |
| 去重维度 | `(reporter, type, target)` | `(user, blocked)` |
| 效果 | 记一条待运营处理 | 改变「我」的视野 |

- `uk_report_once(reporter_id, target_type, target_id)` 不只是为了去重：
  没有它，运营后台会被一个人的重复举报刷屏，而真正的举报淹在里面�?  换个人举报同一�?*应该**成功（去重维度含 reporter）�?- 错误码段位用 **8xxxx**（内容治理），与 6xxxx 的审核分开：审核拦的是
  �?*机器判定**违规」，举报处理的是�?*人举�?*」，运营后台要分开看这两类�?- `NotificationType.REPORTED = 7`，文案刻�?*不回显举报人身份** —�?  那等于让举报人暴露，从此没人敢举报�?- **举报只是记录，不自动处置**：删内容/禁言是运营的权限，需要审核与申诉流程�?  「举报即隐藏」会让任何人都能靠批量举报让别人的笔记消失�?
## 拉黑必须**双向**生效

`UserBlockMapper.selectHiddenUserIds` �?`UNION` 取两个方向：
我拉黑的�?+ 拉黑我的人。做成单向的话，「拉黑」就成了一个只能自己藏别人�?但藏不住别人的按钮，与现实里的直觉相反�?
- 过滤�?**SQL �?*做（`AND n.user_id NOT IN (...)`）而不是查回来再筛 —�?  否则 `total` 会和 `list` 对不上，分页会出现「明�?total=20 却只显示 18 条」�?  注意 `@Select` 里用�?`<if>/<foreach>` �?*必须�?`<script>` 包裹**（见下）�?- 覆盖面：首页**两个�?*（发�?+ 关注）、作者主页、笔记详情�?  后两个走 `NoteQueryServiceImpl.requireVisible`（与 `getDetail` 共用�?  所以点赞人/收藏人列表也一并被挡住），前两个走 `FeedMapper`�?- 详情页按�?*不存�?*」（20001）处理，**不给「TA 拉黑了你」任何提�?* —�?  那等于把对方的操作暴露出去，会把普通屏蔽变成社交对抗�?- 刻意**不因拉黑而取�?*：关注是「我订阅�?TA」，拉黑是「我不想看到 TA」，
  两者独立。这样「取消拉黑」之后还能看到历史关注内容�?
### ⚠️ 注解里的动�?SQL 必须�?`<script>` 包裹

`@Select` 里写 `<if>/<foreach>` 时，MyBatis **只认�?`<script>` 包住的字符串**
才会当动�?SQL 解析，否则它们被当普通文本，foreach 里的 `#{id}` 变成一�?「找不到的具名参数」，报：

```
BindingException: Parameter 'id' not found. Available parameters are [hiddenIds, userId, ...]
```

症状离真因隔了一�?—�?报错说的是参数名，不是「你忘了 script 标签」�?
**包上 `<script>` 之后又有第二个坑**：SQL 文本会被�?XML 解析，所�?**不能出现裸的 `<` / `&`**。原来的 `n.user_id <> #{userId}` 就是非法 XML�?启动时直�?`SAXParseException: Error creating document instance`�?报错说的是「创�?document 实例失败」，�?SQL 语法毫无关系�?MySQL �?`<>` �?`!=` 等价，换�?`!=` 绕开转义�?
另外 Java **文本�?*要求 `"""` 之后必须紧跟换行，所�?`<script>` 不能�?开分隔符同�?—�?要写在下一行�?
### 两条「报错离真因很远」的自测教训

1. **补充说明�?200 字返回的�?100001（DTO 层），不�?80003（业务去重）**�?   `@Size` 在进业务之前就拦下了。写成期�?80003 就会红，
   而「先入为先」不是「先业务后参数」�?2. **CDP 里不能用首页两个流验拉黑**：它们只取第一�?20 条且按时间倒序�?   固定搭子的笔记比本组前几段刚造的数据旧，**根本不在第一�?*�?   拿第一页断言会变成「恒真」—�?看着绿，其实钉不住任何东西�?   契约层按 noteId 精确断言（服务端、确定性），CDP 层只验界�?   （作者主页笔记数 + 详情页拿不到）�?
### 举报去重�?*永久**的，没有撤回接口

所以第二次�?`ui-follow` 的举报提交必然拿�?80003。这是产品承诺的行为�?因此那条断言写的是�?*有明确反�?*」（首次成功关弹�?/ 重复举报给出提示），
而不是「弹窗一定关闭」。这与「用 `||` 掩盖不稳定」不同：两个分支
各有自己的提示文案，都是被保证的行为�?
### 测试基建：清理必须放�?`finally`

`ui-follow` 这一段崩在清理之前，拉黑关系留在库里�?**下一轮「关注流出现测试笔记」会永远超时** —�?症状与新代码毫无关系�?看起来像是拉黑功能把关注流弄坏了。改�?`finallyCleanup` 数组�?�?`finally` 统一执行后才稳定。这�?P15 记的 `ui-notification` 是同一个坑�?
### P19 视频：上�?+ 原文件播放（�?commit�?
契约 **543 �?*�?29 + 14�?9 段），CDP **462 �?*�?53 + 9，ui-note）�?
**本轮刻意只做「上�?+ 存原文件 + 播放器」，不做转码�?* 这是明确的边界而不是省事：
转码要引�?ffmpeg 依赖、CPU 开销、以及「转码失败怎么办」的一整套状态机�?属于要单独立项的工程。反过来，「能上传能播」这件事本身有价�?—�?之前 `note.video_url` 存了�?*详情页根本没�?video 标签**，等于这个字段是死的�?
- 新增 `VideoStorage` 接口 + `LocalVideoStorage`（默认实现）�?*刻意不与
  `ImageStorage` 合用**：两者约束完全不同（图片 10MB、每�?9 张；
  视频 200MB、每�?1 个），共用就得在每个方法里问「这次是图还是视频」�?- `POST /api/note/video`：multipart�?*只放�?mp4 / webm**�?  限流 `10/min`（比图片�?30/min 严得�?—�?一个视频就是几十上�?MB）�?- `application.yml` �?`multipart.max-file-size` 提到 200MB。调大它**不会**让图�?  突破 10MB，因为那�?`LocalImageStorage` 里另一道代码校验�?- 安全模型与图片完全一致：文件名一�?UUID、扩展名**�?content-type 反查**
  （绝不使用用户提供的原始名，否则 `../../etc/cron.d/evil` 能路径穿越）�?  拼完路径�?`startsWith(dir)` 确认一次、按日期分目录�?- 前端：发布页「发视频」是一�?*切换模式**，不是同一�?input 里混�?—�?  一篇笔记要么图文要么视频（`note` 表只�?`cover` �?`video_url` 两个位置），
  混着选会让用户传�?3 张图再选个视频、最后只生效一半�?  详情�?`<video controls preload="metadata" playsinline>`�?  `preload=metadata` 而不�?`auto`（一进页面就下上�?MB 不可接受），
  `controls` 必须留（移动端自动播会被拦，且有声自动播很烦人）�?
## 四个刻意的取�?
1. **mov / avi 一律拒�?*�?00001）：这两种浏览器不能直接播，放行它们等于
   「传完看到黑屏加一个下载按钮」，比明确拒绝更糟。前端在选文件时就提示转格式�?2. **不校验魔�?*：只�?content-type 白名单。要做魔数校验得引入 `FileTypeDetector`
   之类的依赖，而现在这条链路的价值是「能上传能播」，不是防伪�?3. **不做封面抽取**：视频笔记的 `cover` 可以为空，详情页的播放器没有 poster�?   抽帧�?ffmpeg，属于转码那一档�?4. **删笔记时不删视频文件**：与图片一致（图片文件本体也留�?`uploads/`）�?   文件残留只是浪费一点磁盘，不该让删除接口失败�?
## 两条测试上的自坑

1. **契约里我自己写的 `up()` 返回解析后的 body，我却按 `{ json: x }` 解构** —�?   断言报的是「code=undefined」，与「上传失败」毫无关系�?2. **未登录返回的�?HTTP 200 + body code 10005**，不�?401。断言�?401 写会红，
   而红的原因（约定记错）与视频功能无关�?
CDP 那边还踩了一次：`exists`/`text`/`click` 三个 helper �?`ui-note.mjs` �?**本来不存�?*（我�?`ui-interaction` 记混了），第一次跑�?`exists is not defined`�?补的时候又用了字符串拼接而不是本项目惯用的模板字符串�?结果报出 `t is not defined` —�?那个 `t` 是节点侧变量，压根不该出现在浏览器里�?**helper 要照抄同项目里已经跑通的那个文件，别凭印象写�?*

- **prod 真调用已�?*（走 nginx 18080）：3MB mp4 上传 `code=0` �?发布 type=2 �?  详情 `videoUrl` 一�?�?静�?GET 200/`video/mp4`、字节数与上传相�?�?  mov �?100001 �?删笔�?0�?2MB 那一档在 dev 验过�?*�?10MB 配置必然炸，
  这是唯一必须真传大文件才能验的点**）。prod 探针账号�?8.4 的模式手删干净�?
- **`multipart.max-file-size` 提到 200MB 是有代价�?*：容器层兜底值一放宽�?  单请求就能占 200MB 内存。限�?`10/min` 是唯一防线，别为了「少传几次」调大它�?
### P20 运营管理后台（本 commit�?
契约 **591 �?*�?43 + 48�?0.1 段），CDP **485 �?*�?62 + 23，新�?`ui-admin`）�?
**它填的不是一个假想需求，而是一处已经悬了很久的空洞**：P18 的举�?「只记录、不自动处置」，`report` 表里�?`status` / `handle_note` 列都建好了，
�?*没有任何运营接口** —�?举报进去就没人管了。顺带堵�?P3 遗留�?「草稿（status=0）只有管理端能造」缺口，并第一次有了账号级处置能力�?
| 接口 | 说明 |
|---|---|
| `GET /api/admin/report/list?status=&targetType=` | 举报列表�?*带被举报内容摘要 + 举报�?* |
| `GET /api/admin/report/pending-count` | 待处理数（红点） |
| `POST /api/admin/report/{id}/handle` | body `{action, handleNote}`，见�?|
| `GET /api/admin/user/list?keyword=&status=` | 用户列表，带笔记数与**被举报次�?* |
| `PUT /api/admin/user/{id}/status` | body `{status:0\|1}` 禁用/恢复 |
| `GET /api/admin/note/list?keyword=&status=&type=` | 笔记列表�?*不过滤状�?* |
| `PUT /api/admin/note/{id}/status` | body `{status:1\|2}` 强制下架/恢复 |

处置动作：`1` 驳回（`status=2`）、`2` 下架笔记、`3` 删除笔记、`4` 禁用作�?（这四个都把举报标成 `status=1` 已受理）�?
### 三个设计决定，每一个都有代�?
**�?鉴权按「路径前缀」而不是注解�?*
`AdminInterceptor` 拦整�?`/api/admin/**`。做�?`@RequireAdmin` 注解的话�?新接口漏加注解就�?*静默越权** —�?没有任何人会注意到；而漏掉前缀是一整条前缀都漏�?测试立刻炸。路径前缀是「默认全保护」，注解是「默认全保护，但要记得手动上锁」�?
**�?role 刻意不写�?JWT，每次查库�?*
token 里带 role 看起来省事（少一次查询），但**撤权要等 token 过期才生�?*�?而「把某个运营降级」几乎总是出事后要立刻做的�?—�?等两小时那段时间�?他照样能删数据。token 一旦签发就收不回来，这�?JWT 无状态设计的固有代价�?只能�?*需要即时生效的字段**上退回查库。管理端流量低，这次 PK 查询可以忽略�?
**�?禁用账号 = 封号，且写操作当场失效�?*
`AccountStatusInterceptor` 对所�?POST/PUT/PATCH/DELETE 再查一�?`status`�?登录本来就拒（`USER_DISABLED=10007`），但那不够：手上那个还没过期的 token
照样能发内容，从运营视角看就是「我明明禁了他，他怎么还在发」�?**读操作刻意不�?*：被禁用的人自己得能看到「我账号出什么事了」，
看不到只能去问客服；同时读是浏览热路径，不该为它加开销�?代价写在明面上：每次写多一条主键索引查找�?
### 三个「不这么做会静默出错」的地方

- **处置动作不可重放**：已处理的举报再处置一�?`90003`。真正的风险不是重复点按钮，
  而是**两次不同的处置落在同一批内容上**（先下架再删除，用户看到的笔记就凭空消失）�?  `status` �?`action` 推导而不让调用方直接传，就是为了不让运营自己�?  「下架之后这条举报该标成什么状态」�?- **运营改笔记状态必须复用作者那条路�?*（`NoteService.forceChangeStatus`）�?  下架要撤搜索索引靠的�?afterCommit 发的 UNPUBLISH 事件；复制一�?update + 事件代码�?  后果是「运营下架了但用户还能搜到」—�?那是一�?*只有运营能发�?*的静默不一致�?  删除同理（`deleteAsAdmin` �?`delete` 共用 `deleteCascade`）�?- **举报对象可能已经不存�?*（作者自己删�?/ 被上一条处置删了）�?  列表里这�?`targetExists=false` 并提示「建议直接驳回」，**不报「处理失败�?*�?  顺带一条产品事实：**举报没有撤回接口**，所以目标被删之后举报就成了孤儿行，
  测试数据清理必须带上 `report` 表（见第 5 节）�?
### 错误码分段：9xxxx 是「只有运营能触发�?
`8xxxx` �?*用户能触�?*的动作（我举报了 / 我拉黑了），`9xxxx` �?*只有运营能触�?*的�?分段之后日志与网关能按前缀分开统计 —�?用户侧举报激增和运营侧越权尝�?是完全不同的两件事，混在一个段位里看不出区别�?
`FORBIDDEN_NOT_ADMIN(90001)` 刻意**不复�?* `10005`（未登录）：两者要分开告警�?未登录是流量问题，一�?`10005` 说明有人在撞�?*已登录却不是管理�?*说明有账�?被错误提权，那是**安全事件**�?
### 三个「不能禁」与两条默认�?
`90004` 禁自己（把自己关在门外且无人能解）、`90005` 禁另一个管理员
（否则一个运营能把自己这条线的同事全干掉）�?运营笔记状�?*只认 1/2 不认 0**：草稿是作者自己的中间态，
运营把别人的笔记按回草稿会让「这篇笔记消失了但没人下架过」成为可能�?
### 测试基建

- **管理�?fixture 是常驻的**：`xk_ui_admin` / `xk_ui_admin2`，口�?`Xk@2026peer`�?  契约�?CDP �?*不新建管理员**（role 只能从库里改，而这两层都不该动数据库）�?  而是各自**第一条断言就检�?fixture 还在** —�?fixture 没了会立刻报出来�?  而不是让后面几十条集体假红成「鉴权坏了」�?- `ui-admin.mjs` �?�?步会�?`xiaoku_demo` 禁用�?*恢复必须排在 finally 的最�?*�?  不恢复的话后�?ui-search / ui-follow 全都登不进去，而症状看起来与它们毫无关�?  —�?�?P15 记的「清理不�?finally 里」是同一个坑�?- `switchIdentity` �?token 前必须先 `goto` 到应用域名：会话初始停在 `about:blank`�?  那是**不透明�?*，读 localStorage 直接 `SecurityError`（首次跑就撞上）�?- 契约那段踩了三个自坑，都写进注释了：�?`uploadImage` 返回 `{status,json,text}`�?  URL �?`json.data.url` —�?直接把返回值塞�?`imageUrls` 会让发布�?`100001`�?  �?同一个坑�?P19 �?`up()` 上已经踩过一次，**同类助手的返回形态不一�?*�?  �?本段只注�?2 个账号（register 10/min/IP，再多注册会把其中一个打�?`100005`
  �?登录拿不�?token �?`Bearer undefined` �?后续全返 `10006`「凭证无效」，
  看起来像「鉴权坏了」）；④ 最后一条断言原本写成「恢复后能重新登录」，
  而跑到文件末尾时 login �?60/min/IP 桶已经见�?�?改成�?*手里那个已被禁用过的
  token** 验证恢复，这也更准确：恢复要对同一会话立刻生效�?
### 已知取舍

- **没有分页 UI**：三张表都取 `size=50` 一次，没有「加载更多」�?- **没有操作审计**：谁在什么时候处置了什么，只体现在 `report.handle_note` 的自由文本里�?  真实系统需要一张独立的 `admin_operation_log`�?- **`report_count` 是关联统计而不是冗余列**：user/note 列表里都带它�?  真要提速可以加异步刷新的列，但那会引入「刷列失败导致运营按旧数据处置」的坏情况�?- **前端 role 判断只是界面提示**：「我的」页的运营入口按 `role === 1` 渲染�?  但改 localStorage 就能让这一行出现。真权限�?`AdminInterceptor`�?  所�?`AdminView` �?`90001` 的处理是**正常分支而不是兜�?*（它会把用户退回「我的」）�?
### P21 手测修复：通知撤回 + 举报入口 + 作者主页（�?commit�?
契约 **618 �?*�?91 + 27�?1 段），CDP **517 �?*�?85 + 32：layout 125�?39
新增作者主�?+14、note 108�?23 新增两处举报 +15、follow 43�?6 新增「⋯」入�?+3）�?
本轮**没有新功�?*，全�?2026-10-08 手测暴露出来的四类问题。手测的价�?不在于「发现新 bug」，而在于它暴露�?*测试本身的覆盖空�?* —�?后三�?都是「测试从没量过这个地方」�?
#### �?通知与实际互动不一致（数据层缺陷，不是 UI 问题�?
**现象**：用户已取消点赞 / 评论已被删除，但通知中心的通知还在，点进去�?「笔记不存在」或「内容不存在」�?
**根因**：P15 写通知时是**单向**�?—�?只在互动发生�?INSERT，没有任�?撤回路径。`uk_notify_once` 保证同一 `(receiver, actor, type, target)` 只有
一行，于是「点赞→取消点赞」留下的那行通知**永久**指向一个已不存在的
关系行。通知与互动数据的一致性从 P15 起就是断的，只是没人去核对过�?
**修法**：`NotificationService` 加三个撤回方法，一一对应四类撤回时机�?
| 方法 | 时机 | 撤回范围 |
|---|---|---|
| `retract(receiverId, actorId, type, targetId)` | 取消点赞 / 取消评论�?| 精确那一�?|
| `retractByTarget(type, targetId)` | 删评�?| 该评论收到的一切通知 |
| `retractByNoteId(noteId)` | 删笔�?| 这篇笔记收到的一切通知 |

全部�?**afterCommit + try/catch 吞异�?*，与「写通知」同一套约�?—�?通知写失败不该让点赞回滚，撤回失败同理�?
⚠️ **`COMMENT` 是聚合通知，不能按 commentId �?*：它在收到评论时是一条，
`target_id` 存的�?*被评论的笔记**（一篇文章被评论 20 次也只有一行）。所�?删评论时只能撤「该评论者在**这篇笔记**下的**最后一�?*评论」—�?判断依据�?`commentService.countByNoteAndUser(noteId, userId) == 1`。少了这个判断，
删掉 20 条评论中的第 1 条就会把剩下 19 条的聚合通知一起撤掉�?
#### �?举报入口只有作者主页有（覆盖空洞）

用户问「笔记和评论能不能举报」。查下来 `ReportSheet` 只挂�?`UserView.vue`
一个地�?—�?也就是说�?*笔记详情页的「⋯」菜单里没有举报**�?**每条评论的「⋯」里也没�?*。这是「功能做了，但只在最容易做的一处做了」�?
修法：新 `MoreSheet.vue`（Vant ActionSheet 的薄封装，自定义 `xkKey` �?data-test），三处入口 —�?作者主页顶栏、笔记详情顶栏、每条评论行�?`ReportSheet` + `useReportSheet` 提成共用（原来逻辑就在 `UserView` 里）�?
⚠️ **Vant 4 �?ActionSheet 选项字段�?`name` 不是 `text`**，选回值走
`action.xkKey`（`name` 已被 Vant 占用）；浮层�?**teleport �?body** 的，
懒渲染与否都影响 `await waitAndClick` 的可见性判定�?
#### �?作者主页从未进过布局体检（一次改动抓�?2 处真溢出�?
`ui-layout-audit` 一直量 6 个页�?× 2 视口�?*`/user/:id` 不在里面**�?于是 2026-10-08 手测一打开作者主页就看到「拉�?举报被压成两行」�?
加进 `PAGE_LIST` �?*当场红了两条**，而且都不是玄学：

- `section.card` scrollW 241 / clientW 238（溢�?3px�?- `div.who` scrollW 217 / clientW 190（溢�?27px�?
`div.who` 那条�?*根因是设计而不是样�?*：把「⋯」塞进头部那一行后�?那一行要同时装下 头像 62 + 昵称 + 用户�?+ 关注�?75 + �?40 + 两个 gap 28
= **205px**，�?240px 侧栏减去内边距只�?**190px 可用**�?
修法两条�?*第一条是「⋯」根本不属于那一�?*�?
1. **「⋯」移到顶�?*。小红书的三个点也在页面右上角（9ok.com / 3DM �?   操作说明都是「点右上角三个点」），不在头像旁边。移走之后那一行回�?   188px，装得下�?2. **桌面侧栏 240px �?300px**，与 `ProfileView` 对齐。P13 修过**同一�?*
   缺陷（`@xiaoku_demo` 溢出压掉「编辑」按钮），当时把 `ProfileView`
   加宽了却没看 `UserView` —�?同一套组件模式、元素还更多�?
**教训**：「加一条断言」比事后修三�?bug 便宜得多，�?*加之前先想清�?「这个页面为什么当初没被量�?* —�?作者主页漏掉的原因�?P13 那次一样：
fixture 用的�?`xiaoku_demo`�?1 字符），而手测用�?`xk_ui_follow`
�?3 字符）恰好会溢出，短的那个永远测不出来�?
#### �?无封面笔记的媒体块高度是 0（`aspect-ratio: 3/4` 的隐藏前提）

`NoteDetailView` 的图框是 `aspect-ratio: var(--r, 3/4)`�?*没有图片�?`--r` 没被设置**，回退 3/4，于�?`.col-media` 渲染出一�?*正比于宽度的�?盒子**——里面是空的。左下角挂个吉祥物看着像占位图，实际是拉高了一整块�?
`HomeView` 也有同一个错：给无封面笔记回退到吉祥物时，顺手�?*吉祥物的
宽高�?*写进�?`--r`，于�?1080×1440 的吉祥物被当�?3/4 的图框裁切�?
修法：`:has-media` 才渲�?`.col-media`（没有图就没有这个列），
`--r` 只在真的有图时才写。两处都�?ui-note / ui-layout 里有断言�?
#### �?编辑笔记也必须带图（补后门）

P11 只给 `publish` 加了「图文必带图」（`validatePublishParams(dto, true)`），
**编辑�?`false`** —�?于是「发的时候干净、编辑时塞进去」这个后门一直开着�?正是 P15 审核段那条注释里点名担心的形状。改�?update 也传 `true`�?
⚠️ **这会打脸已有的无图笔�?*：`xk_ui_follow` 名下 5 �?P6 时代的笔�?`cover IS NULL`，编辑它们时必须同时传新图，否则 `100001`。这 5 篇是
CDP 的常驻素材，**补封面时要用 `textCard.ts` �?`brandCoverBlob` 生成
1080×1440 封面，并且带上原 title/content**（P10 起编辑是全量覆盖）�?
### P21 测试基建：一个残留拉黑让**三个组同时变�?*

`ui-follow` / `ui-search` / `ui-notification` 三组在一次全量连跑里同时
失败，且**每组的报错都指向自己的功�?*（超�?20001/元素缺失），没有一�?提到拉黑。清�?`user_block` 里的一条残留后**三组全绿**�?
那条残留是手测时点过「拉黑」留下的。危害在于：

- `user_block` **双向生效**（`selectHiddenUserIds` �?`UNION`），
  拉黑之后被拉黑者的笔记�?*所有人**不可�?�?关注流空、搜不到�?  作者主页笔记列表空。三组各自的症状完全不同�?- **`finallyCleanup` 救不了它**：解拉黑虽然登记�?`finally` 里，�?  `ui-follow` �?*拉黑之前**要断言「拉黑前能看�?TA 的笔记」（这是 P18
  加的前置断言）—�?而崩掉时那条断言已经跑过，清理正常执行了�?  真正的原因是**手测**点的那一次，与脚本无关�?
**判据**：三个以上不相关组同时变红、而每组症状都指向自己的功能时�?**先查全局状�?*（`user_block` / `user.status` / `note.status`），
不要逐个组去调断言。这�?P15 记的「通知跨轮累积」的同源问题�?**自造用例不能假设库是干净�?*�?
### P21 已知取舍

- **撤回只在服务端做，前端不做兜�?*：`NotificationBell` 拿到的列表可�?  含极短暂的「通知还在、但目标已删」窗口（撤回�?afterCommit 的）�?  要彻底消掉得�?VO 里带 `targetExists` 并在读时过滤，代价是每条通知
  多一次存在性判断�?- **`COMMENT` 聚合通知的撤回是「删到最后一条才撤�?*：用户删掉自己在
  某篇笔记下的唯一一条评论时通知消失；删到还剩别的评论时通知保留�?  「我删了评论但通知还在」在「别人还评论过」的情况下是**正确**的�?- **作者主页的「⋯」在 `<1024px` 时仍可见**（顶栏），但作者主页本�?  移动端只有一个窄�?—�?小红书在移动端作者主页也是把更多操作收进右上角，
  这条是对齐的，不是妥协�?
### P22 私信（本 commit�?
契约 **620 �?*�?18 + 2�?2 段），CDP **537 �?*�?17 + 20，新�?`ui-message`）�?
**为什么现在做私信**：P0~P21 有内容有关系、有话题、有 @、有举报有黑名单�?�?*没有「人和人」这一�?* —�?整个产品偏内容广场而不是社交站。私信是关系�?的最后一环，补上之后才谈得上「社交产品」�?
#### 三个范围决定，都�?*取舍**而不是「还没做�?
1. **只做 1 �?1，不做群聊�?* 群聊要多一张成员表，而小红书自己也很少用 —�?   「有但没人用」的功能会把每个页面都撑复杂。群聊是之后�?*同一个会话模�?*
   上加一层（`message_session` 的两列换成成员表）�?2. **投递用轮询�?5s / 5s），不用 WebSocket�?* 零新依赖、可上线、能验收�?   代价是消息最多晚 15s 出现。小红书客户端本来就是长连接，网页版用轮询是常规做法�?   接口层不需要为这个选择做任何让�?—�?�?WebSocket 只改投递这一层，业务不动�?3. **不做「撤回」与「编辑已发送的消息」�?* 两者都要额外状态机
   （撤回要记谁撤的、编辑要保留历史），�?`message` 表刻�?*没有 `update_time`** —�?   消息是不可变的事实�?
#### 两个关键设计

**�?会话用「较小ID + 较大ID」规范化存储，而不是「发起方 + 接收方」�?*

A �?B 发消息与 B �?A 发消�?*必须落在同一行会�?*。若存「发起方+接收方」，
`uk_session_pair (user_id, peer_id)` 会因为方向不同而全部放�?—�?「先查再插」在两人同时首次发消息时，两个事务都能查到「不存在」，各自插一�?（与 `topic` �?`uk_topic_name` 同一个道理）。规范化之后 `(min,max)` 有序�?`(min,max)` �?`(max,min)` �?*物理�?*就是同一行，唯一索引才真正当裁判�?
写入侧是 `insertIgnore` + 冲突后重查，而不是先查再�?—�?竞态收�?SQL 内部�?
**�?未读数冗余在会话行上（`unread_low` / `unread_high`），不做实时 COUNT�?*

会话列表是全站最常被打开的页面，实时聚合的代价与消息总量成正比�?漂移方向�?*安全�?*：只会多不会少（读消息失败时不清零，下次进会话页会再减一次）�?不会出现「有未读却显示已读」。读的时候用**绝对�?0** 而不是「减掉本页条数」—�?重复执行会减成负数，�?`GREATEST(0, x)` 只是把错误藏起来
（与 P8 `NoteCounterFlushJob` 的「绝对值覆盖」同一思路）�?
#### 拉黑互禁：错误码刻意**不区分是谁拉黑了�?*

`user_block` 是双向生效的（P18），所以发私信前查「我们之间有没有任何一条拉黑关系」�?返回�?`50004` message 是「消息发送失败」�?*不是**「你已被对方拉黑」—�?P18 已经定过这个原则：把对方的操作暴露出去会把普通屏蔽变成社交对抗�?
⚠️ �?*「消息发不出去」这个结果无法隐�?*（不发错误码前端会以为发送成功）�?这是整个设计里唯一没法完全藏住的地方，代价限定在「知道对方在屏蔽我」，
换不来的是「能绕过屏蔽继续发消息」。同样的理由�?`50005`（会话不存在）与
被拉�?*刻意同码** —�?告诉对方「会话不存在」等于告诉他「你被屏蔽了」�?
#### 三个自测时踩到、且症状离真因很远的�?
1. **`waitFor('!document.querySelector(\'[data-test=x-loading]\')')` �?*瞬间**通过**�?*
   组件还没挂载时那个元素就不存在，条件已经为真 —�?于是「等加载完成」根本没等，
   紧接着的断言全在空页面上跑。正确写法是�?*终态元素出�?*�?   `document.querySelector('[data-test=row], [data-test=empty]')`�?   （与 P12-C �?`auditPage` 补的终态等待是同一类问题，但方向相反。）
2. **`token.ts` �?`accessToken` 是模块级 ref，模块加载时读一次就固定了�?*
   应用已启动后再改 localStorage�?*内存里那份不�?*，axios 仍带旧身份的 token
   发请�?—�?表现是「换了身份但列表还是空的」。换身份必须走一�?*完整导航**
   让应用重新启动；`location.reload()` 塞在 evaluate 里会销毁执行上下文�?   与紧跟的 goto 打架（实测落在空列表上）�?   �?localStorage 同理：不重新导航�?*不算登出**�?3. **MySQL 的中文输出在 PowerShell 里显示成 `?`，会被误判成「数据写坏了」�?*
   验证要用 ASCII 谓词：`CHAR_LENGTH(COLUMN_COMMENT)` / `REGEXP '[^\\x00-\\x7F]'` /
   `LIKE '%?%'`（全 0 才是好）。灌 DDL 也有三档�?   `Get-Content -Raw | mysql` �?中文全变 `?`�?   `cmd /c "type f.sql | mysql"` �?按控制台 OEM 代码页转换，一半字坏掉�?   **只有 `node` �?`spawnSync({input})` 能让字节原样送达**�?   读文件同理：`Get-Content` 默认�?ANSI �?UTF-8，中文注释会变成乱码�?*破坏 SQL 字符�?*�?
#### 其他刻意不做

- **不做「谁看过我的私信�?*、不做已读回执的逐条时间戳（只做会话级已读）�?- **不做聊天记录分页 UI**：后�?`page` 参数在，但前端只取最�?50 条�?  真要加得先定「往上翻还是往下翻」的产品口径�?- **私信没有撤回**（见上）�?- **`message` 上没�?`update_time`**，所以编辑消息需要改表�?
### P22 已知缺口

- **测试会留下消�?*：`ui-message` 每轮�?`xk_ui_smoke �?xk_ui_follow` 之间
  �?2~3 条消息，�?*私信没有删除接口**（P22 刻意不做撤回）。所�?  `message` 表会随轮次累积，断言必须�?*相对增量**而不是绝对值�?  要清就按�?5 节的模式按前缀删（消息正文�?`P22` 开头）�?- **两个 fixture 之间现在有常驻会�?*：`xk_ui_smoke` 的会话列表不再为空，
  �?`ui-message` 里「空列表」的分支只在第一次跑时成立�?- **气泡里的长文本会换行**（`overflow-wrap: anywhere` + `pre-wrap`），
  但没做「长消息折叠」—�?那要额外的高度测量，�?P12 那套 `--media-h`
  机制已经被删掉了（理由见 P12 段：它是为了「评论进右栏」而存在的）�?
### P23 推荐：可解释的热度分（本 commit�?
契约 **621 �?*�?20 + 1�?7.5 段改写），CDP **537 �?*（不�?—�?纯后端）�?
**先量后写**：立项时的假设是「物�?`hot_score` 列能让排序进索引、消�?filesort」�?动手前先量了真数据，**假设被推�?*�?
```
现状�?20 条：已关�?= 20/20（全是我关注的人�?年龄区间�?16h ~ 288h（全�?9~12 天前的内容）
信号强度�?0% 的笔记互动为 0，中位数 0，最�?6
零关注新账号看到的发现流�?8/20 恰好都是 216.1h（那批种子数据）
```

**性能论证不成�?*�?99 篇笔记、discover p95 �?80ms（远低于项目自己�?600ms 预算）。物化列要付出「异步刷�?+ 漂移」的**确定成本**，而时间衰减项
会随时间变，光靠 `NoteCounterFlushJob` 那个计数刷新的钩�?*刷不干净**�?还得再加一个周期�?decay job。换一个当下量不出来的收益 —�?不做�?
**真正的毛病是排序质量**�?0% 内容零互动时，`互动 DESC, 时间 DESC` 实际等于
「按互动分层、层内按时间」，于是 9 天前的内容霸榜，新内容全被埋�?
#### 公式：`(1 + 3·�?+ 4·�?+ 5·�? / (发布天数 + 7) ^ 0.5`

每个常数都是对着真数据量出来的：

- **常数 1 的基�?* —�?让零互动内容也有正分，否则新内容永远出不来�?- **权重 3/4/5** —�?评论比点赞贵（要打字、还产生通知），收藏比点赞贵
  （是「我要回来看」的信号）。权重差距刻意不大：库里最大互动量只有 6�?  再放大只会退化成「谁赞多谁赢」�?- **天数 + 7** —�?一周内的年龄差异几乎不影响排序（除�?7�?4 只差 1.41 倍，
  而互�?0�? �?19 倍）�?- **指数 0.5** —�?开方，见下�?
#### ⚠️ 照抄 Hacker News �?*整个翻转排序**（实测）

HN �?`(1+3L+4C+5Cm)/(age_hours+2)^1.5` 在本项目是错的，因为**两个信号的量�?完全不匹�?*：互动量只有 0~6（分�?1~30），年龄跨度却是 0~216 小时
（除�?2.9~3240）�?*衰减比互动强两个数量�?*，于是�? 小时前发的零互动测试
笔记」以 0.054 分压过�? 天前�?6 互动内容」（0.006 分）—�?�?8 �?*全是**
刚发的零互动内容，排序等于失效。把指数降到 0.5、年龄单位从小时改成天才配平�?
**教训**：照抄一个「公认合理」的公式之前，先拿自己的数据跑一遍�?公式的形状取决于**两个信号的量级比**，而量级比是每个项目自己的性质�?
#### 一条契约断言被换掉（换的是它�?*语义**，不是它的强度）

P14 钉的是「同一档内互动量非递增」。P23 起第二排序键不是互动量了，这�?**必然**会红 —�?第一次跑就红�?`...,3,3,4,2,...`（互动从 3 涨到 4）�?
新的断言�?*在测试侧把公式重算一�?*再比对：只断言「互动量非递增」会漏掉
常数被改动的情况（公式与断言脱钩），而重算等于把
`(1+3�?4�?5�?/(天数+7)^0.5` 这个形状钉死 —�?谁改�?`FeedMapper` 里的常数
而没同步这里，这条立刻红�?
另加一�?*反向断言**：互动量本身允许非递增。若它红，说明数据里互动量恰�?单调，用例失去区分力�?*不是代码有问�?*）—�?这类「用例自己失去区分力�?的判断必须写出来，否则下一个人会当成回归去查�?
#### ⚠️ 本项�?SQL �?*不能�?`--` 注释**（新坑，报错极具误导性）

�?`@Select` 的文本块里加了三�?`-- P23 热度分：…` 注释，整个接口立刻返
`100999`，后端日志是�?
```
Caused by: java.sql.SQLException: sql injection violation, dbType mysql,
            druid-version 1.2.28, comment not allow : SELECT n.*
```

**报错说的是「SQL 注入」，与真因（我写了注释）隔了整整一�?*�?而症状只是「接口返 100999」。Druid �?wall filter 默认拒绝带注释的 SQL�?本项目的 SQL 注释一律写�?Java 侧�?
（顺带：Java 文本块不能写�?`""" + CONST + """` 来拼常量 —�?`"""` 之后必须紧跟换行，拼接会报「文本块开始定界符非法」。AGENTS �?5 �?记过同类形状。）

### P23 已知缺口

- **没有用户画像**。真正的推荐要按「我常看什么」调整排序，现在只有
  「关注优先」这一个用户侧信号。数据量够（笔记�?&gt; 5000 �?  互动分布不再长尾）时才是下一步�?- **`user_follow.status` 是废弃列但仍�?`pageDiscover` �?EXISTS 依赖**�?  P6 起关�?取关走物理删，这一列理论上该恒�?1 —�?现在库里 12 行确实都�?1�?  但哪天有个写入路径忘了维护它，排序会**静默**变成「已关注不优先」，
  而症状是「发现流里我关注的人不见了」。要么补写入、要么把条件去掉�?- **热度分是全局的，不随 viewer �?*。同一�?`hot_score` 对所有人生效�?
  而它应该至少按「我关注的人的互动」加权�?

### P39 主页对齐：背景头�?+ 移动端两列瀑布（本 commit�?

契约 **747** 条（726 + 21），CDP **727** 条（710 + 17，ui-profile 51�?8）�?

两项都是「补齐与小红书的差距」，但成本差一个数量级：两列瀑布是纯 CSS�?
背景头图要动 `user` �?+ 上传 + 白名单�?

#### 抓到的五个真问题 —�?三个�?*测试自己的错**

**�?P23 那条断言与实现口径不一�?�?随机假红（本轮最有价值的一条）**

契约跑出一�?`未关注段内热度分非递增` 红，而服务端排序**完全正确**�?
根因是两边算的不是同一个东西：

```
服务�?SQL�?/ POW(TIMESTAMPDIFF(HOUR, n.create_time, NOW()) / 24 + 7, 0.5) DESC
             —�?TIMESTAMPDIFF(HOUR,...) 取的�?*整小�?*（截断）
测试�?JS�?(Date.now() - new Date(createTime)) / 3600000 / 24
             —�?**小数�?*
```

实测抓到的一组（2026-10-19）：

| 笔记 | 互动 | 截断口径 | 小数天口�?|
|---|---|---|---|
| `2026-10-18 20:10` | �? | 4/�?25/24+7) = **1.4106** | 4/�?25.898/24+7) = 1.4073 |
| `2026-10-08 18:48` | �? | 6/�?267/24+7) = **1.4094** | 6/�?267.264/24+7) = 1.4089 |

服务端按截断口径 �?前者略�?�?排序正确�?
测试按小数口�?�?后者略�?�?断言说「非递增」断了�?

除数�?`�?days+7)`，days 差最�?1/24，而那点差别在**两篇几乎同分**的笔�?
之间足以翻转顺序。库里笔记一多（当时 574 篇）就必然撞上�?

> **教训**：P23 定的那条「在测试侧重算公式」本身是**对的**
> （只断言「互动量非递增」会漏掉常数被改动）�?
> �?*重算的公式必须与 SQL 逐字对齐**，否则它测的是「两套公式的差�?
> 而不是「实现的形状」�?
> 修完之后这条断言反�?*更强**�?—�?它现在连「SQL 用的是整小时截断」一起钉住�?
>
> ⚠️ 顺带把取样时刻提前到**发请求之�?*：服务端�?`NOW()` 是查询执行的那一刻，
> 测试侧若在拿到响应后才取 `Date.now()`，两者差一个网络往�?—�?
> �?1 秒不影响分数，但**跨过整点边界**时会把某篇笔记的小时桶算错一格�?

**�?白名单把「清空」当成非法�?�?提示的方向是反的**

`UploadedUrlPolicy` 第一版对空串�?`10009`，�?10009 的文案是
「背景图地址不合法，**请重新上�?*」—�?用户点的是�?*清除**」，
提示却让他去上传。空串必须返�?`null`�? 清空），
由调用方�?`LambdaUpdateWrapper` 显式 `set null`
（`update-strategy: not_null` 会把 null 剔除掉，理由�?P3 �?bio）�?

**�?三份 `onCoverLoad` 复制**已经开始漂�?

`useCoverRatio` 收编之前，这段逻辑�?HomeView / CollectionsView / TopicView
里各抄了一份�?*CollectionsView 那份漏了 P21 的「无封面不写 `--r`」守�?* —�?
于是收藏夹里没封面的笔记被写进吉祥物�?00×212 横图）的比例�?
卡片比同列别的矮一截�?

> 这就是「抄多份的必然结果」，�?*漂移的方向是静默的视觉差�?*�?
> 没有任何报错。P39 顺手把三处都收敛�?`src/composables/useCoverRatio.ts`�?

**�?两条�?CSS**（AGENTS P35 的教训，又一次）

`ProfileView` / `UserView` 里的 `.avatar { width:62px; object-fit:contain }`
�?P35 换成 `<UserAvatar>` 组件之后**就已经匹配不上了** —�?
组件渲染的是 `class="xk-avatar"`，没�?`avatar` 这个类名�?
而且它的 `contain` 与组件自己的 `cover` **相矛�?*�?
留着的话哪天有人把类名改回去，圆形头像里会露出一张带白底的方图�?

**�?CDP 又忘了等终�?*（P38 记过的坑，自己又踩了一次）

量「移动端两列」时列表还在加载中，而模板是
`v-if="listLoading"` �?提示 �?`v-else-if="!list.length"` �?空�?�?`v-else` �?列表�?
加载中时 `.items` **根本不在 DOM �?*，`querySelector` 返回 null�?
正确条件是�?*没有**加载�?**�?*（列�?**�?* 空态）」�?

#### 三个设计决定

**�?背景图没有「预设」这一档，但规则是同一份�?*

头像有两个合法来源（8 张预�?/ 本站上传），背景图只有后者�?
所�?`UploadedUrlPolicy` 只管「本站上传路径」这一条规则，
`AvatarPresets` 保留「预设」那一档并**复用**前者�?

> ⚠️ 抽出来是必须的：两处各写一份的话，可疑字符清单迟早漂移�?
> 而漂移的方向是「一边放行了一边没放行」—�?*那是个安全洞**�?
> 契约里那 9 条攻击样�?*故意与头像那一组完全相�?*�?
> 就是为了钉住「两处规则不许分叉」�?

**�?头像压在背景条下�?*（小红书主页的样子）：整行上移半个头像（62/2 = 31px），
头像上半截在图上、下半截在图下�?*只在有背景图时上�?* —�?
没有背景图时也上移的话，头像会浮在卡片上边缘外面�?
那是「缺了个东西」的观感，不是设计�?

**�?背景条用负外边距「出血�? 卡片 `overflow:hidden` 裁成 blob 圆角�?*

`margin: calc(var(--xk-card-pad) * -1) calc(var(--xk-card-pad) * -1) 0`
出血�?*边框内侧**（卡片自己的描边仍然可见）�?
`overflow:hidden` 是必需的：不裁切的话图的四角会盖住圆角描边�?
视觉上就是「图片戳出卡片」�?

#### 顺带做的

- `backend/scripts/check-contract-structure.mjs` —�?契约文件的结构体检
  （花括号净�?/ 深度 2�? 次数�?HEAD 对比）。P17 记过那三条不变量�?
  但每次都是手数；这个脚本让「插入式改动有没有顺手删掉下一句」变成一条命令�?
  ⚠️ 它自己的第一版把**字符串先于注�?*剥错了顺�?—�?
  `http://localhost` 里的 `//` 被当成行注释，于是花括号净数报 -1�?
  **�?HEAD 版本也报 -1** —�?那就是工具自己的错而不是文件的错�?
  「对照组也报同样的错」是区分这两者的判据�?

### P39 已知取舍

- **背景图不做裁�?压缩**：沿�?`ImageStorage` 原样存储�?
  一�?4MB 手机照片会原样存、原样下发给每个看到该主页的人�?
  �?P36 的头像遗留项是同一个问题�?
- **背景图不参与缓存�?*：`UserVO` �?Redis 缓存，改背景图会 `evictUserVO`�?
  所以别人看到的也是新的 —�?�?*正在看那个主页的页面**要等下次拉取才更新�?
- **移动端两列瀑布�?CSS `columns`**，所以顺序是「先横后纵」而不是「先纵后横�?
  （与桌面端一致）。瀑布流的列顺序在小红书上也是按列填的�?
- **作者主页（UserView）也改了两列**，与「我的」主页一致�?
  搜索�?/ 话题�?/ 收藏夹本来就是两列或三列，没动�?
- **隐私设置不在本轮**（要动发现流/关注�?搜索/沉浸流四条查询，单独一轮）�?

### P40 布局收口：首屏见笔记 + 桌面只留一条顶栏（�?commit�?

CDP **735** 条（727 + 8）�?*纯前端，零后端改�?*，契约仍 747�?

起因是用户看了一�?P39 �?prod 界面说�?*怎么看着怪怪的**」�?
量下来是两处�?

| 现象 | 实测 |
|---|---|
| 移动端首屏被设置项占�?| 430×900：顶�?16 �?资料�?72(h224) �?**设置链接�?296(h314)** �?Tab 646 �?第一张笔记卡 **704**（h219，底 923 > 900�?*�?23px 塞不�?*�?|
| 桌面两条顶栏 | SiteNav（毛球喵�?搜索/首页/发布/我的/关注/铃铛/主题/退出）下面又是一条「我的�? **又一个主题钮** |

#### 三个真发�?

**�?全仓 `router-link-active` �?0 �?—�?SiteNav 根本没在表达「我在哪�?*

四条链接长得一模一样，用户点完不知道自己在哪�?
而「靠 SiteNav 表达位置」这个前提此�?*根本不成�?*（我第一版方案就是基于它�?
review 时才发现截图里「我的」并没有高亮 —�?**我看错了**）�?

⚠️ 补高亮时**必须�?`router-link-exact-active` 而不�?`router-link-active`**�?
后者是**前缀**匹配，而首页链接的 path �?`/` —�?于是 `/` �?*每个**页面都命中，
结果是「首页」永远高亮、当前页永远不高亮�?
契约侧补了一�?*反向断言**（在 `/profile` 上首页链接的字重必须�?400），
因为只断「我的高亮了」抓不到这个 bug（首页同时也高亮，看着还挺对）�?

**�?「全站统一隐藏页面顶栏」不能一刀�?*

盘了 15 个带 `.top` 的页面：

| 类别 | 页面 | 结论 |
|---|---|---|
| 能整条隐�?| **ProfileView** | 顶栏只有「我的�? 主题钮，SiteNav 两者都有，内容区还�?h1 昵称 |
| 会明确丢信息 | TopicView�?话题名是**全页唯一副本**）、AdminView（h1 在顶栏里）、ProfileEditView（h1 在顶栏里）、NoteEditView�?*保存**按钮）、PublishView�?*发布**按钮）、NotificationView�?*全部已读**）、MessageView�?*全部私信** + 对方昵称）、SearchView（返回首页） | 逐页拆「功能件」与「标题�?|
| 只丢页面类型标识 | CollectionsView / BlockListView / MessageListView / FollowListView / UserView / NoteDetailView | 下一�?|

所以本轮只�?ProfileView�?*B-a**），其余 14 个页面留�?**B-b**�?

**�?通知入口的形态必须跟着变，否则就是「删了入口�?*

设置卡挪到笔记下面后，「通知」入口变�?—�?而通知是高频入口�?
于是把铃铛放�?*移动端顶�?*（小红书的做法），链接卡里删掉「通知」行�?

⚠️ �?P15 记过「移动端铃铛会压住主题切�?返回」—�?那条是针�?*首页**顶栏�?
（那里有搜索框和返回键），�?ProfileView 顶栏只有标题 + 主题钮�?
且这里用的是**正常�?*里的铃铛，不�?P15 否掉�?**fixed 浮标**�?

#### 一个「假绿」被注入验证抓出�?

新加的断言是「移动端首屏能看到第一张笔记卡」，第一次写成了
「整张卡塞进首屏（top + h �?vh）」。注入回退�?*它没有红** —�?
量出�?audit 用的账号（`xiaoku_demo`，没背景图，资料卡比有背景图时矮 132px�?
第一张卡落在 y=674、高 219 �?893 �?900�?*照样塞得�?*�?

> **教训**：判据不能依赖「这个账号恰好有没有背景图」�?
> 改成**结构�?*判据：「设置链接卡�?top > 第一张笔记卡�?top」—�?
> 与账号状态无关，且直接对应「设置项不再挡在内容前面」这个目标�?
> 注入回退后立刻红（linksTop=312 < firstTop=674）✓
> ui-profile 那条 `firstTop < 600` 同样有判别力（注入后 674 �?红）�?

#### 顺带修掉的既有毛�?

`.side` 在移动端是普�?block div，两张卡之间**没有间距**
（实�?资料卡底 296 = 链接卡顶 296）。提升成 flex item 后有�?`.page` �?16px gap�?

### P40 已知取舍

- **「全站统一隐藏顶栏」只做了 ProfileView**：其�?14 个页面各有各的理�?
  （话题名是唯一副本 / h1 在顶栏里 / 顶栏挂着保存、发布、分享、全部已读�?
  更多操作这些功能件），要逐页拆，属于 B-b 那一轮�?
- **通知铃铛在「我的」页顶栏不是「第二个入口�?*：链接卡里的「通知」行
  已删掉，移动端是顶栏铃铛、桌面端�?SiteNav 铃铛�?*每个视口各一�?*�?
- **私信入口仍在设置卡里**（挪到了页面底部）：没有现成的「图�?+ 角标」组件，
  另做一个要多一个文件；私信的未读数�?`useMessageUnread`�?
  与通知�?`useUnreadCount` 是两套（两个接口、两个表、两种「未读」）�?
- **移动端「我的」页的设置区在笔记下�?*：`退出登录` 也在那里�?
  `ui-smoke` �?`waitFor` + 程序�?click，不依赖元素位置 �?

### P41 手测修复：运营后台看不懂 + 编辑资料页重叠（�?commit�?

CDP **766** 条（735 + 31）�?*纯前端，零后端改�?*，契约仍 747�?

用户给了 3 �?prod 截图 + 两句反馈�?
「运营后台根本就看不懂这是什么意思�?「用户的个人资料编辑界面会出现重叠」�?

#### �?编辑资料页的按钮重叠（真 bug�?

**症状**：「换一张」被压成**竖排单字**（换/一/�?三个字一行）�?
「清除」按钮横�?*溢出卡片右缘**�?

**根因**：全站的 `.xk-btn` �?`width: 100%`（main.css）—�?
那是给「保�?/ 发布 / 登录」这�?*通栏主行�?*设计的�?
「清除」复用了它，放进 flex 容器后它�?flex base size = 100%�?
于是把「换一张」挤到只剩一个字宽（文字逐字换行），自己还溢出容器�?

**修法**：这一行里的按�?*都不能是通栏** —�?
`.bg-clear` 覆盖 `width: 100%` �?`flex: none`�?
`.bg-actions .upload` �?`flex: none` + `white-space: nowrap`�?

> ⚠️ **布局体检抓不到它**（试过）：溢出检查量的是「内容溢出容器」，
> 而这里「清除�?*并没有溢�?*（`flex-shrink` 把它缩回去了），
> 被压扁的�?*另一�?*元素。体检量不到「flex item 被挤扁」�?
> 所以只能在 ui-profile 里断，且必须�?*「清除」存在的时刻**
> （没背景图时�?`v-if` 不渲染，两个按钮不并排，bug 也不出现�?
> + **显式切到 430px**（默认视口是浏览器窗口大小，�?bug 只在窄容器下出现）�?

**顺带**：背景预览从 `object-fit: contain` 改成 `cover` + `3:1`�?
原来 contain 让图两侧留一大片空白�?*看起来像「图没加载出来�?*�?
而主页上横幅本来就是 cover 裁的 —�?看到的就是发布之后的样子（WYSIWYG）�?

#### �?运营后台「看不懂�?

原来的后台只有三�?tab（举�?用户/笔记�? 一堆操作按钮，
第一次进来根本不知道「该看哪」「驳回和下架笔记差在哪」。改了四处：

| 改什�?| 为什�?|
|---|---|
| **每个页签一句「这页是干什么的�?* | 三个页签管三件不同的事，一次只说当前这一件。比一句总说明有�?|
| **「作者（已注销）�?举报人」拆成两个带标签的行** | 原来只隔一个「·」，读起来像**一个人的两个属�?* —�?而这恰恰是这页最需要说清的一件事（谁举报了谁�?|
| **「被举报内容」为空时不显示那个空标签** | 原来无条件渲染标签、再在下面补一句「内容已不存在」，读起来像漏了内容 |
| **处置按钮�?targetType 过滤** | 后端本来就拦「给评论下架笔记」（返「评论不能下架」），但 UI 把四个动作全摆出�?—�?运营点了才看到报错，那不是「更严谨」，是让人以为系统坏�?|

**行宽也失控了**：原来没有上限，桌面 1920px 下整行拉�?—�?
左边内容、右边孤零零一个时间戳�?1700px 处，中间一千多像素的空白�?
那不是「留白」，是排版失控。`.list { max-width: 880px }`�?

**空�?*原来只有一句「没有待处理举报」，运营会以为功能坏了�?
现在说清楚「为什么空�?「东西从哪来」�?

#### �?又一个「覆盖空洞�?

`ui-layout-audit` �?`PAGE_LIST` 只有 6 �?—�?
**「编辑资料」和「运营后台」从来没被几何体检扫过**�?
这与 P21 的作者主页是同一类问题（加一条比事后修三�?bug 便宜得多）�?
本轮把「编辑资料」加了进去（+13 条断言）；
运营后台�?`ui-admin` 那组里量（那里是管理员账号，审计用的是普通用户）�?

⚠️ 运营后台**不能**直接加进 layout-audit：审计用普通账号，
进去会拿 90001 并被重定向回「我的」—�?量到的会是另一个页面�?

### P41 已知取舍

- **运营后台仍无分页 UI**：三张表都取 `size=50` 一次�?
- **「禁用作者」在目标已不存在时仍可点**：作�?id 还能从举报行里取到，
  禁用一个已被处置的人的号意义不大，但也没害处�?
- **评论举报没有「删掉这条评论」的动作**：后�?`ReportAction` 只有
  驳回 / 下架笔记 / 删除笔记 / 禁用作者，评论的「删」没有对应动�?
  （`deleteNoteAsAdmin` 只处理笔记）�?*这是后端的能力缺�?*�?
  本轮只做 UI 过滤（评论不给「下�?删除笔记」），没扩后端�?

### P41b 运营后台版式重做（本 commit�?

CDP **766** 条（762 + 4）�?*纯前�?*，契约仍 747�?

用户看完 P41 的内容修复后说�?*运营后台�?UI 界面还需要改，结构改清晰一点，
看上去一塌糊涂的**」。查下来**根因比预想的严重**�?

#### 根因：这一�?*从来没被设计�?*

`AdminView.vue` �?`<style scoped>` �?*只有 13 个选择�?*
（`.help .list .head .badge .detail .what .quote .who .sep .warn .handled .done .ops`）—�?
**`.top` / `.tabs` / `.filters` / `.search` / `.err` / `.tip` 全都没有样式**�?
走的是浏览器默认�?

| 元素 | 实际长什么样 | 后果 |
|---|---|---|
| `.top` 里的 `<h1>运营后台</h1>` | 默认 h1�?*2em = 32px**�?| 那个标题巨大无比，与下面全是很小的元素，比例失衡 |
| `.tabs` 里的 `<button>` | **浏览器默认灰按钮** | 页签长成灰药�?|
| `.filters` 里的 `<button>` | **同样是浏览器默认灰按�?* | **两组控件长得一模一�?* —�?运营分不清哪个是「切页面」哪个是「筛内容�?|
| `.search` 里的 input/button | 默认样式 | 搜索框与整页不搭 |
| `.err` / `.tip` | 默认段落 | 错误与空态长得像正文 |

也就是说：这一�?*只有列表内部那十几行被设计过**，外框、页签、筛选�?
搜索、空�?*全是浏览器默�?*。用户说「一塌糊涂」是准确的�?

#### 改法：建�?*层级**，不是加装饰

| �?| 改什�?|
|---|---|
| �?页签 | �?**带下划线的真 tab**（active 琥珀下划线），与首页「发�?关注」同�?|
| �?筛�?| �?**分段控件**（装在带边框的容器里，active 是实心琥珀�?|
| �?列表�?| �?**卡片**（边�?+ 圆角 + 底色 + 内边距），卡间有间距 |
| �?卡片内部 | �?分四块：头行 / 主体（被举报了什么）/ 双方（谁举报了谁�? 操作 |
| �?整页 | �?桌面限宽 **960px**（原�?1200px，单列工作台摊得太开�?|
| �?字段标签 | �?「被举报的笔记」「举报人补充」「被举报人」「举报人」统一成小号圆角标�?|

⚠️ **形状必须与别的控件区分开**，这是这次改版的核心�?
页签�?*下划�?*、筛选用**实心�?*、卡片用**边框**—�?
三种形状各管一层，运营一眼能分�?

#### 三条新断言（都做了判别力验证）

| 断言 | 断的�?*机制**而不是颜色�?|
|---|---|
| 页签是「下划线」形�?| `border-bottom-width �?2`（而不是「颜色是不是琥珀」） |
| 筛选是「分段控件」形�?| `background-color` 不透明（而不是「长得像不像药丸」） |
| 列表项是卡片 | `border-width > 0` �?`border-radius > 0` |
| 430px 下四个处置按钮排成一�?| 四个按钮�?`top` 相同（`new Set().size === 1`�?|

**判别力验�?*：把版式改回浏览器默认（`!important` 覆盖成无边框/无圆�?透明底）�?
三条**全部变红** �?

> ⚠️ 最后一条必�?*显式切到 430px** 量：默认视口是浏览器窗口大小（不确定），
> 而「四个按钮排成一行」只在窄屏下有意义�?
> 顺带修了按钮内边距（`space-4` �?`space-3`）：原来 88px × 4 + 间距 = 376px
> > 可用 354px，最后一个「禁用作者」会换到第二排�?

### P39 prod 部署与真调用

部署顺序�?.2 / 8.5 / 8.6 三条都适用）：
`mvnw -DskipTests package`�?*不带 `-o`**）→ 临时 Dockerfile 只复刻运行时阶段
�?*不装 curl**、静�?Linux �?ffmpeg/ffprobe 直接 `docker cp` 从旧容器取出�?
COPY 进去，因为本�?`tar -xJf` 解不�?xz）→ `.dockerignore` 临时放行 jar
�?*还原�?`git checkout --`**，别�?`Set-Content -Encoding UTF8`，会�?BOM）→
build backend �?`--no-deps --force-recreate backend` �?`docker build frontend` �?
`--no-deps --force-recreate frontend` �?**重启 nginx**�?.5）�?

⚠️ **prod 库要手动加列**（`user.background`）：

```sql
ALTER TABLE xiaoku_db.user ADD COLUMN background VARCHAR(512) DEFAULT NULL
  COMMENT 'home background url' AFTER avatar;
```

prod 真调用：**接口 13/13**（上�?�?写入 �?回读 �?4 类攻击样本全�?10009 �?
被拒后原值没被改�?�?空串清空 �?还原�? **界面 17/17**（移动端两列 lefts 49/254�?
桌面三列 464/691/918、背景条 132px、头�?175~237 跨在背景条下�?206 上�?
背景�?`naturalWidth>0`）�?

⚠️ **prod 界面验收必须先造数�?*：prod 库里**一篇笔记都没有**
（刻意保持干净给人看界面），所以「我的」页的笔记列�?*根本不会渲染**
（`v-else` 分支）—�?直接断言两列会得�?`found:false`�?
而那**不是回归，是没有数据可排**。要�?**3 �?*探针笔记�?
两列的断言需�?�? 篇占满两列，三列的断言需�?�? 篇占满三列�?
⚠️ 探针的清�?*必须放进 `finally`**：第一版把 `noteIds` 声明�?`try` 内，
`finally` 里引用抛 ReferenceError �?3 篇探针永久留�?prod 库里
（症状是「prod 突然冒出几篇 P39 探针笔记」，与真因隔了一段）�?
现在 prod 笔记数回�?**0**�?

### P42 运营能点进去看被举报的原文（�?commit�?

契约 **753** 条（747 + 6），CDP **772** 条（766 + 6）�?*前端 + 后端都改�?*�?

起因：用户看�?P41b 说�?*但是我不能点击跳转看被举报的那一篇帖子吗**」�?

#### 查出来的三件事（比「点不进去」更严重�?

| 事实 | 后果 |
|---|---|
| 举报行只�?`targetTitle` + `targetContent`�?*�?100 字文�?*），`AdminReportVO` **没有 cover/images**（�?`AdminNoteItemVO` 是有的） | **图片违规的举报，运营在后台看不到任何图片** �?根本无法判断要不要处置�?*「点原文」不是锦上添花，是核实的前提** |
| 管理员不是作�?�?`requireVisible` 对「已下架」返 20002 | 点进去是**死链** —�?而被举报的笔记很可能**已经被下�?*（作者自己下的，或另一个运营刚处置过） |
| 评论举报�?`targetId` �?*评论 id**，VO 里没有「评论所在笔�?id�?| 评论举报**连跳的地方都没有**（拿评论 id 拼笔记详情会 404�?|

#### 三个决定（用户拍板）

1. **管理员能看已下架笔记的原�?* —�?否则这批举报只能无脑驳回，审核闭环断�?
2. **管理员视角下只读** —�?否则管理员的点赞�?*混进普通用户的计数**，而那个计数被用来排序发现流（P23 热度分）= 审核行为污染推荐，且没人会发�?
3. **评论举报不定位到具体那条评论**（这轮不做）—�?原文已在举报行里；定位要�?`GET /api/comment/{id}`（现在只有按笔记分页�?`/list`�?

#### 后端两处

**�?`AdminReportVO` �?`targetNoteId`**
笔记举报 = 笔记 id；评论举�?= `CommentEntity.noteId`�?*该字段本来就有，只是没摊�?*）�?
前端只用一个字段就能拼出跳转地址�?

**�?`requireVisible` 给管理员放开「已下架�?*

```java
if (status == STATUS_TAKEN_DOWN && !isAuthor) {
    if (!isAdmin(currentUserId)) {
        throw new BizException(ErrorCodeEnum.NOTE_STATUS_ILLEGAL, "该笔记已被下�?);
    }
}
```

三条安全约束�?

- ⚠️ **只放开「已下架」，不放开「草稿�?*：草稿是作者的**私有**内容，公开流里根本看不到，
  不会有草稿的举报；放开它等于让管理员能看任何人的私有草�?—�?那是审核不需要的权限
- ⚠️ **只在本来要抛异常的那条路径上多查一次库** �?正常看已发布笔记的热路径**零成�?*
- ⚠️ **查库�?`role == 1`，不�?`UserQueryService.findUserVO`**：后者带 `@Cacheable`�?
  而管理端的角色变更（把某个运营降级）**不会**清这个缓�?—�?
  走缓存的话，降级后他仍能看已下架笔记，直到缓存过期�?
  这与 `AdminInterceptor`「不�?role 写进 JWT」是**同一条理�?*�?*撤权必须立刻生效**

#### 前端两处

**�?举报行的被举报内容变链接**：笔�?�?`#/note/{targetNoteId}`�?
`targetExists === false`（已不存在）�?不给链接�?

**�?详情页的管理员只读视�?*�?
`isAdminReadonly = role === 1 && status === 2` �?顶部一条提示条
（「这篇笔记已被下�?—�?你以**管理�?*身份查看（只读，不能点赞/评论）」）+ **隐藏整个吸底操作�?*�?

⚠️ 顺带修掉一个隐患：`.page` �?`padding-bottom` �?`calc(var(--bar-h, 112px) + ...)`�?
�?`--bar-h` �?ResizeObserver 实测写入（操作栏不在就没有这个值）�?
管理员视角会白占 **112px** 空白。用一�?`watch` 在只读时把它�?0�?

#### 三条断言写错了、被抓出来的

| 断言 | 错在�?| 真因 |
|---|---|---|
| 「已下架的笔记：普通用户仍被拦」用�?**tA** | tA 正是那篇笔记�?*作�?* | 作者本来就能看自己的下架笔记（P10 既有语义：「明明是自己的却突然 404」，编辑入口需要它）�?*改用非作者的 token** |
| 「评论举报的行带 targetNoteId�?| 拿前�?*已被处置�?*的那条评论举报去�?| 它不在「待处理」列表里 �?查出来是 undefined�?*自己造一条新�?* |
| 「点被举报内容能跳到那篇笔记」插在了中间 | 插完就跳走了 | 后面的用例（用户 tab / 笔记 tab）都在后台页面上�?�?报「超时：用户 tab 渲染」，**症状与真因隔了好几屏**�?*点完要回后台** |

> 三条都是**测试自己的错**，不是实现的问题�?

#### 顺带的发�?

`CommentQueryServiceImpl.listByNote` **只查笔记存在性，不查状�?* —�?
所以已下架笔记的评论列表任何人都能列出来（详情页到不了而已）�?
这轮没动它（不在范围内），但记一笔：**「评论没有下架这个状态」是既有的产品口�?*�?

### P42 prod 部署与真调用

部署顺序�?.2 / 8.5 / 8.6 三条都适用，且**后端也改�?*）：
`mvnw -DskipTests package`�?*不带 `-o`**）→ 临时 Dockerfile 只复刻运行时阶段
�?*不装 curl**、静�?Linux �?ffmpeg/ffprobe 直接 `docker cp` 从旧容器取出�?
COPY 进去，因为本�?`tar -xJf` 解不�?xz）→ build backend �?
`--no-deps --force-recreate backend` �?`docker build frontend` �?
`--no-deps --force-recreate frontend` �?**重启 nginx**�?.5）�?

⚠️ **prod 库不用改�?*：`targetNoteId` �?VO 的字段，不是列�?

prod 真调�?**12/12**�?

- 举报行带 `targetNoteId`�? 被举报笔�?id）✓
- 运营下架 �?管理员能拿到详情（`status=2`）✓
- **普通账号仍被拦**�?0002）✓
- 举报行的被举报内容是**可点链接**（`<a>` + 下划线）�?
- 点进�?*落在被举报的那一篇笔�?* �?
- 管理员看已下架笔记：有「以管理员身份查看」提示条 �?
- 管理员看已下架笔记：**没有吸底操作�?*（只读）�?
- 管理员看已下架笔记：**没有点赞按钮**（不污染计数）✓

⚠️ **prod 验收踩到的两个坑（都不是产品问题�?*�?

1. **prod 现有的两个账号都是管理员**（`xk_ui_admin` / `xk_ui_admin2`，role 都是 1），
   所以「非作者被拦」用它们**验不出来** —�?管理员本来就该看到�?
   要验就得**临时注册一个普通账�?*，验完按前缀删掉（AGENTS 8.8 的派生表物化写法）�?
2. **重复举报�?80003**（`uk_report_once(reporter_id, target_type, target_id)`）：
   挑笔记时必须**排除已经举报过的那几�?*，否则造数据就失败�?
   而症状是「后面几条全红」�?

### P43 桌面端页面顶栏降级（�?commit�?

**纯前端，零后端改�?*�?

#### 起因与量�?

P40 改完「我的」页后，发现**桌面端是两条顶栏**�?
`SiteNav`（品�?+ 搜索 + 首页/发布/我的/关注 + 铃铛 + 主题 + 退出，67px�?
下面又一�?*页面顶栏**（�?笔记详情 / 通知 / 发布笔记 / 我的收藏 …，40px）�?
两条都是「带边框的横条」，叠在一起像两个应用�?

实测 6 个页面的顶栏在桌面端都是 40px、紧贴在 67px �?SiteNav 下面�?
详情�?/ 发布�?/ 通知 / 私信列表 / 收藏�?/ 编辑资料�?

#### 改法：降级而不是隐�?

顶栏**留着** —�?返回键、分享、保存、全部已读、⋯ 这些功能件都住在里面�?
隐藏它们等于删功能。但�?

- 去掉它自己的背景与下边框
- 标题降成小字（fs-15�? 次要�?

于是它读起来是「内容区上方的一排工具」，而不是「另一条顶栏」�?

⚠️ **移动端完全不�?*：那里没�?SiteNav，页面顶栏就是唯一的导航，
去掉边框会让人找不到返回键�?

⚠️ 也不�?*首页**：首页的顶栏早就在桌面端 `display:none` 了（P12-C）�?

**一�?CSS、零模板改动**（`main.css` �?`.page > .top` 规则）—�?
14 个页面一起受益�?

### P44 隐私设置：私密账号（�?commit�?

契约 **779** 条（753 + 26），CDP **780** 条（772 + 8）�?*前端 + 后端都改�?*�?

#### 规则（用户拍板）

- 私密账号的笔�?*只有关注�?TA 的用�?*能看�?*单向关注也算**，作者本人当然能�?
- 发现�?/ 搜索 / 沉浸�?/ 作者主页：**只对有权限的人显�?*
  （非关注�?*直接不返�?*，而不是返回了再点进去报错�?

#### 数据

`user.is_private` TINYINT NOT NULL DEFAULT 0�? 公开 / 1 私密）�?
存量库要手动 `ALTER`（dev �?prod 都加了，`sql/schema.sql` 已更新）�?

#### 关键决定一�?*可见性规则只有一份实�?*

「这篇笔记对 TA 不可见」要�?*好几个地�?*判断 —�?
笔记详情、评论列表、发现流、搜索、作者主页�?
两处各写一份的话，规则迟早漂移（一处加了「作者本人可见」另一处没加）�?
�?*漂移的方向是私密内容泄露** —�?那是这个功能最不能出的错�?

所以抽�?`com.xiaoku.module.note.support.PrivacyGate`�?
详情页与评论列表都调它（发现�?搜索�?SQL 层的另一套，见下）�?

#### 关键决定二：**不可见时�?20001（不存在），不是 20002（状态不对）**

「这篇是私密内容，你看不到」这句话**本身就泄露了信息**�?
而「不存在」没法区分「从没存在过」和「存在但你看不到」�?

⚠️ 顺序也重要：私密判断必须�?*「已下架」判断之�?* —�?
否则私密且已下架的笔记会�?20002「该笔记已被下架」，
等于说「有篇私密笔记，只是被下架了」�?

#### 关键决定三：**发现流的过滤�?`IN` 列表，不用相关子查询**

`pageDiscover`（发现流 + 沉浸流共用）的排序第一级已经是
`EXISTS (SELECT 1 FROM user_follow ...)` —�?**逐行**的相关子查询
（AGENTS P14 实测 discover p95 �?80ms，排序那一级就�?DEPENDENT SUBQUERY）�?

所以过滤也�?*同一个思路**但反过来做：把「我关注了谁」的 id 列表传进 SQL
（`UserFollowQueryService.listFollowedIds`，新增），用
`u.is_private = 0 OR n.user_id IN (followedIds)`�?

关注�?*不用�?* —�?它列的就是我关注的人，天然满足「我有关注权限」�?

#### 关键决定四：搜索�?**MySQL �?*过滤，不�?ES 索引

ES 索引里没有隐私信息。加 `isPrivate` 字段就意味着
「改隐私设置时要重建该作者的索引」—�?那是 AGENTS P7 踩过�?
「改 analyzer 要重建索引」的坑�?

�?`SearchServiceImpl.hydrate` **已经**批量查了作�?VO 和关注关�?
（它本来就要�?`authorFollowed`）→ 过滤**零额外查�?*�?

⚠️ **代价：搜索的 total 会偏�?*（total 取的�?ES 的命中数�?
�?ES 不知道隐私）。这�?*已知取舍**�?
搜索�?total 本来就因「ES 与库不同步」而抖动（被删的笔记也在里面）�?
私密笔记占比通常很小 —�?不为了这个精度去动索引结构�?
表现：搜索结果里私密笔记**不出�?*，但「共 N 条」可能略大�?

#### 前端

- **编辑资料�?*：「账号可见范�?= 公开 / 私密」两个选项 + 一句说�?
- **「我的」页**：昵称旁边一个小圆角标签「私密�?
- **作者主�?*：私密账号的笔记列表为空时显示「该账号已设为私密，关注后可见�?
  （而不是「还没有发过笔记」—�?那是误导�?

⚠️ **关掉私密靠传 0，不靠不�?*�?
后端 `update-strategy: not_null` 只剔�?null�?*0 会被照写** �?
所以前端每次保存都带上 `isPrivate`�?

#### 抓到的四个真问题（三个是测试自己的错�?

**�?布局体检当场抓到「编辑资料」页 2 处重�?*

我给「账号可见范围」加了个说明文字（`.field-hint`），
�?`.field` 的兜底规�?`.field > :not(.label):not(.count)`
�?*所�?*非标�?非计数的子元素都塞进**�?2 �?* —�?
于是说明文字和「公开/私密」按�?*落在同一�?�?互相重叠**�?

⚠️ 而且**光在 `.field-hint` 上写 `grid-row: 3` 争不过它**�?
兜底规则的选择器特异性是 **0,3,0**，`.field-hint` 只有 0,1,0�?
只能**在兜底规则里排除�?*（`:not(.field-hint)` �?0,4,0）�?

> 这正是「加一条比事后修三�?bug 便宜得多」—�?那页从没被体检扫过（P41 才加进去）�?

**�?契约测试造的举报从不清理，累积到 139 �?*

举报**没有删除接口**（P18：「举报去重是永久的，没有撤回接口」）�?
所以契�?CDP 每轮造几条就往「待处理」列表里堆几件�?
几轮之后堆到 139 条，�?admin 列表 `size=50` �?
**ui-admin 组找不到自己那行 �?�?*�?

而且�?*不只是「测试数据脏�?*：它�?*掩盖真实缺陷**
（运营看到的列表被前面的旧举报占满）�?

修法：契约测试造完举报**自己处置�?*（驳�?�?status=2），
并清�?dev 库里累积�?139 条�?

**�?我那两处 `?.` 漏写 �?潜在的崩�?*

```js
.find(e => ...)?.querySelectorAll('...').length ?? 0
```
`?.` 只保护到 `querySelectorAll`�?*后面�?`.length` 会在 undefined 上抛�?*�?
正确写法�?`?.querySelectorAll('...')?.length ?? 0`（两�?`?.`）�?

**�?「hash 变了 �?组件换了�?*

`App.vue` �?router-view 套了 `<transition name="fade" mode="out-in">`�?
旧组件要先播�?**0.18s** 的离场动画，新组件才挂载�?
�?`waitFor("location.hash === '#/profile'")` �?*导航开�?*时就满足�?—�?
那一�?DOM 里还是旧组件�?

所以断言组件内容前要**等元素出�?*，而不是查 DOM�?
（P38 的测试之所以过，是因为它保存后还有别的网络往返，动画刚好播完 —�?**运气**。）

#### 契约测试的两个限�?

**�?不能注册新账�?*

`register` �?10/min/IP，而契约文件从头到尾已注册�?4~5 �?
（主�?/ ct2_ / ct3_ / ct4_ / ct_mod / p20a / p20r），
到文件末尾桶早见�?—�?实测「P44 私密作者注册成功」直接返 **100005**�?

改用 **P20 段注册过的专用账�?`ct_p20r<stamp>`**：它�?P20 段用完就没再用过了，
而且�?*本文件专�?*�?—�?万一这段崩了，账号是私密的也不会影响别的�?
（常�?fixture 就不同了：改�?`xk_ui_follow` 会让后面几十段全部假红）�?

⚠️ 用户名要**重新�?*：`p20r` �?P20 �?*块内**声明�?const�?
出了那个 `{}` 就不在作用域了（实测 `ReferenceError: p20r is not defined`）�?

**�?轮询搜索索引要用「有权限的人�?*

私密笔记对陌生人**搜不�?* �?用陌生人轮询�?*永远等不�?* �?
断言恒红，而下一条「关注者搜得到」却是绿的，**两条自相矛盾**�?

#### 顺带的发�?

- **点赞端点�?`PUT /api/note/{id}/like`**（控制器里明�?
  「用 PUT / DELETE�?*不要** POST /like + POST /unlike」）�?
  写成 POST �?**100002「请求方法不支持�?* —�?
  而症状是「点赞没生效」，与真因（方法不对）隔了半屏�?
- **不能举报自己的内�?*�?0004）。所以造「笔记举报」素材时�?
  被举报的笔记必须**别人**发的（主账号发、tA 举报）�?
- **P42 那条断言本来就依赖「列表里恰好有一条笔记举报�?* —�?
  那是「自造的用例假设了库是干净的」，实测上一轮跑过之后那条恰好被清掉就查不到了�?
  现在改成**自己造一�?*并按 id 精确查找�?

### P44 prod 部署与真调用

部署顺序�?.2 / 8.5 / 8.6 三条都适用，且**后端也改�?*）：
`mvnw -DskipTests package`�?*不带 `-o`**）→ 临时 Dockerfile 只复刻运行时阶段
�?*不装 curl**、静�?Linux �?ffmpeg/ffprobe 直接 `docker cp` 从旧容器取出�?
COPY 进去，因为本�?`tar -xJf` 解不�?xz）→ build backend �?
`--no-deps --force-recreate backend` �?`docker build frontend` �?
`--no-deps --force-recreate frontend` �?**重启 nginx**�?.5）�?

⚠️ **prod 库要手动加列**（`user.is_private`）：

```sql
ALTER TABLE xiaoku_db.user ADD COLUMN is_private TINYINT NOT NULL DEFAULT 0
  COMMENT 'private account' AFTER role;
```

prod 真调�?**24/24**：作者本�?/ 关注�?/ 陌生�?× 详情页、评论列表、作者主页列表�?
发现流、沉浸流、搜索，六个方向全对；关掉私密后陌生人立刻恢复可见�?

⚠️ **prod 验收踩到的两个坑（都不是产品问题�?*�?

1. **prod 现有的两个账号都是管理员**（`xk_ui_admin` / `xk_ui_admin2`，role 都是 1），
   所以「陌生人被拦」用它们**验不出来** —�?管理员本来就该看到私密内容�?
   要验就得**临时注册一个普通账�?*，验完按前缀删掉（AGENTS 8.8 的派生表物化写法）�?
2. **图片上传�?multipart**：用只发 JSON 的助手去�?`/api/note/image`�?
   拿到的是错误响应 �?`imageUrls` 里是 undefined �?发布直接 100001�?
   而症状是「发不出笔记」，与真因（上传方式错）隔了半屏�?

### P45 评论举报：定位到**那条**评论（本 commit�?

契约 **791** 条（779 + 12），CDP **786** 条（780 + 6）�?*前端 + 后端都改�?*�?

起因：P42 让运营能点进「被举报的那篇帖子」，�?*评论举报**只能跳到那篇笔记 —�?
而那篇笔记可能有几十条评论，运营得自己一条条找�?

#### 后端两处

**�?新增 `GET /api/comment/{id}`**

评论**总是挂在某篇笔记下面**，所以按评论 id 取它时必须连带校�?
「它所在的笔记对当前用户可见」—�?
否则**私密 / 已下架笔记的评论能被任何人凭 id 读出�?*（这�?P44 之前就是个洞）�?

可见性规则复�?`NoteQueryService.requireNoteVisible`（新增）—�?
**只有一份实�?*，不在评论侧再写一遍（漂移 = 私密内容泄露）�?

**�?`getVisibleOne` �?`getOne` 刻意分成两个方法**

`getOne` �?like/unlike 的响应回填调用，�?unlike **刻意**允许笔记已下架时撤销
（否则会把已执行的删除一起回�?—�?AGENTS P5 记过的坑）�?
�?`getOne` 加门禁就会破坏那条语义，所以另开一个方法�?

#### 前端两处

**�?详情页支�?`?comment=xxx`**

URL 带评�?id 时：
- 先看第一页里有没有那条评论（有就直接高亮 + 滚动�?
- **没有就单独拉一�?*（`GET /api/comment/{id}`）插进列�?—�?因为评论多的笔记
  一页只�?10 条，被举报的那条很可能在第一页之�?
- 高亮：左边框 + 浅底�?*不只靠颜�?*（a11y 的「不只靠单一感官通道」）
- 拿不到就**静默放弃**（那条评论可能已被删，或它所在的笔记对我不可见）—�?
  定位是锦上添花，不该让整页加载失�?

**�?后台举报�?*：评论类型的链接带上 `?comment=<评论id>`

⚠️ 笔记举报**不带**这个参数（笔记本身就是要看的东西）�?

#### 抓到的三个问题（两个是测试自己的错）

**�?契约里我写了错误�?20005，实际是 30005**

注释的错误码�?**30xxx** 段（30001 已点�?/ 30002 未点�?/ **30005 评论不存�?*），
我写成了 20005（笔记域）�?

**�?评论举报�?80004「不能举报自己的内容�?*

评论是普通账号发的、举报也用普通账�?�?它既是评论作者又是举报人�?
改用 admin 举报（评论是普通账号发的，就不是「自己的」）�?

**�?我新写的 CDP 代码又漏�?`?.`**

`row.querySelector(...)` 少了 `?.` �?找不到那行时直接崩�?
（这�?P44 刚犯过的同一个错，第 2 次了 —�?已在 AGENTS 记下。）

#### 顺带确认的一个安全事�?

`GET /api/comment/{id}` 的门禁覆�?*四种**情况�?
草稿 / 已下�?/ 被拉�?/ 私密账号 —�?全部按「不存在」处理�?
契约里对「私密笔记的评论」钉了三个方向：陌生�?20001、关注�?0、作者本�?0�?

### P45 prod 部署与真调用

部署顺序�?.2 / 8.5 / 8.6 三条都适用，且**后端也改�?*）：
`mvnw -DskipTests package`�?*不带 `-o`**）→ 临时 Dockerfile 只复刻运行时阶段
�?*不装 curl**、静�?Linux �?ffmpeg/ffprobe 直接 `docker cp` 从旧容器取出�?
COPY 进去，因为本�?`tar -xJf` 解不�?xz）→ build backend �?
`--no-deps --force-recreate backend` �?`docker build frontend` �?
`--no-deps --force-recreate frontend` �?**重启 nginx**�?.5）�?

⚠️ **prod 库不用改�?*（本轮没有表结构变更）�?

prod 真调�?**13/13**：`GET /api/comment/{id}` 取到那条评论（带 noteId 与正文）�?
不存在的评论 30005、未登录 10005；界面：详情�?`?comment=xxx` **定位到那条评论并高亮**
（左边框 3px + 浅底，滚进了视口）�?

⚠️ **prod 验收踩到的两个坑（都不是产品问题�?*�?

1. **prod 现有的两个账号都是管理员**，所以「陌生人被拦」这类断言用它们验不出�?—�?
   要验�?*临时注册一个普通账�?*，验完按前缀删掉（AGENTS 8.8 的派生表物化写法）�?
2. **图片上传�?multipart**：用只发 JSON 的助手去�?`/api/note/image`�?
   拿到的是错误响应 �?`imageUrls` 里是 undefined �?发布直接 100001�?
   而症状是「发不出笔记」，与真因（上传方式错）隔了半屏�?

## 8. prod 栈运维（2026-10-04 踩出来的，都是环境问题不是代码问题）

### 8.1 prod 后端镜像曾经落后三个阶段（已修）

**现象**：前端已带「发现」tab 部署�?`18080`，但 `GET /api/feed/discover` 返回
`100404 接口不存在`；`DELETE /api/note/{id}` 返回 `100002 方法不支持`
（�?`@DeleteMapping("/{id}")` 明明在代码里）�?
**根因**：prod backend 镜像构建�?**2026-09-29**，而删除接口是 **09-30**（P11�?加的、发现流�?10-04（P14）加�?—�?也就是说**镜像比仓库落�?P11/P12/P14 三个阶段**�?前端一直在重建、后端一直没重建，这个组合是坏的�?
**判据**（下次怀疑时先查这两条，别猜）：

```powershell
docker inspect xiaoku-backend:latest --format "{{.Created}}"     # 本地镜像构建时间
docker inspect xiaoku-prod-backend-1 --format "{{.Image}}"      # prod 容器用的镜像
git log -1 --format="%ad" --date=iso -S'DeleteMapping' -- backend/src/main/java/com/xiaoku/module/note/controller/NoteController.java
```

**教训**：改前端就只重建前端，这个习惯在「后端也有改动」时会静默留�?「新前端 + 旧后端」�?*每次部署前先确认后端镜像日期晚于最后一次后端提交�?*

### 8.2 本机构建后端镜像走不通的三道墙与绕法

`docker compose ... build backend` 在这台机�?*当前跑不�?*，三道墙依次是：

1. **Docker Desktop 守护进程级镜像源拉不�?blob**�?   `image-mirror.r2.daocloud.vip` 连续 3 �?`EOF`，清�?`REGISTRY_PREFIX`
   也无效（那是 compose 变量，镜像源�?daemon 侧）�?   **绕法**：`$env:DOCKER_BUILDKIT="0"` �?classic builder —�?两个基础镜像
   （`maven:3.9.9-eclipse-temurin-17`、`eclipse-temurin:17-jre`）本地都有缓存，
   classic builder 不回源校�?tag�?2. **容器�?Maven 连不�?Maven Central**：`UnresolvableModelException`�?   **绕法**：先在主机上 `.\mvnw.cmd -DskipTests package`�?*不要�?`-o`**�?   本地 `~/.m2` 从没下过 surefire 的依赖，离线模式必然
   `PluginResolutionException`），再用一�?*临时** Dockerfile 只复�?   `backend/Dockerfile` 的运行时阶段，把 `target/xiaoku-backend.jar` 拷进去�?3. **`archive.ubuntu.com` 502**（运行时阶段 `apt-get install curl`）：
   **绕法**：临�?Dockerfile 里先 `sed` �?apt 源换成清华镜像�?
配套的两处临时改动，用完必须还原/删除�?- `.dockerignore` 里有 `target/`，要�?JAR 进构建上下文得临时放�?  （`target/*` + `!target/xiaoku-backend.jar`�?- 临时 Dockerfile �?`backend/Dockerfile.localtemp`�?*别提�?*

⚠️ **还原 `.dockerignore` 别用 `Set-Content -Encoding UTF8`**：PowerShell 5.1 �?`UTF8` �?*�?BOM**，于是第一行变�?`\ufefftarget/`（BOM 不在行首，`.dockerignore`
�?`target/` 就匹配不到了），�?git diff 里只显示�?`-target/` / `+\ufefftarget/`
—�?看起来像「内容没变却�?diff」。直�?`git checkout -- backend/.dockerignore`
更快也更不容易出错�?
**仓库里的 `backend/Dockerfile` �?`.dockerignore` 一个字都没�?* —�?上面三条
全是本机网络环境的问题，把镜像源写进仓库 Dockerfile 会污染所有人的构建�?
### 8.5 只重�?backend 容器�?nginx �?502�?026-10-08 踩过�?
**现象**：`docker compose -f deploy/docker-compose.prod.yml up -d backend` 之后�?prod backend 容器 `health=healthy`、容器内 `curl /api/system/ping` 返回 `{"code":0}`�?但从宿主�?`http://127.0.0.1:18080/api/system/ping` �?**502 Bad Gateway**�?此时如果�?8.1 的判据去查镜像日期，会发现镜�?*确实是新�?*（就是刚 build 的）�?于是得出「镜像没问题、那一定是代码的问题」—�?*结论完全反了**�?
**根因**：nginx �?*启动�?*�?upstream 的主机名解析�?IP 写进配置。backend 容器
重建�?IP 变了（docker 每次 recreate 都可能重新分配），nginx 还拿着�?IP 去连�?连不上就�?502�?*nginx 容器本身完全健康**，所�?`docker ps` 全绿�?`docker inspect xiaoku-prod-frontend-1` 也一切正常�?
**修法**：`docker restart xiaoku-prod-frontend-1` 让它重新解析�?
**判据（一句话�?*：`502` + `后端容器�?curl 正常` + `镜像日期是新的`
= nginx 缓存了旧 IP，不是后端问题，�?*不是**镜像落后于代码�?
⚠️ 这与 8.1 的现�?*完全相反**�?.1 是镜像落�?+ 接口 404/100002），两者都表现�?「prod 行为与仓库不一致」，所以先分清�?**502**（上游连不上 �?重启 nginx�?还是 **业务错误�?*（接口存在但行为�?�?查镜像日期）�?### 8.3 �?analyzer 必须删索引重建（prod 也踩了一次）

�?prod ES 装上 IK 插件后，我用旧后端发一篇「图书漂流」搜「图书漂流」→ **命中�?*�?看起�?IK 生效了�?*这是假阳�?*：那次跑的是 9-29 的旧后端，索�?查询两端都是
`standard`，靠单字匹配碰巧命中；�?`xk_note` �?mapping 当时仍是
`"analyzer": "standard"`�?
**ES 永远不会升级已有索引�?mapping**（AGENTS �?7 �?P10 段已记过一次，
这次�?prod 又踩了一次）。判据只有一�?—�?直接查：

```powershell
docker exec xiaoku-prod-elasticsearch-1 sh -c "curl -s 'localhost:9200/xk_note/_mapping?pretty'"
```

看到 `"analyzer": "standard"` 就是没生效。正确顺序：
**先装插件 �?删索�?�?�?`/api/search/reindex` 让新后端按注解重�?*�?再验证。验证要�?*双字�?*（「图书漂流」这种）：单字词�?standard 下也能命中，
区分不出 IK 与不 IK�?
### 8.4 prod 库里没有演示账号，探针账号要自己注册

`application-prod.yml` �?`init-demo-data` 默认 **false**，所�?prod 没有
`xiaoku_demo`（`Xk@123456` �?prod 登不进去，别再试）。要�?prod 验证就得注册
临时账号�?*后端没有「删账号」接�?*，探针账号会留在库里�?
| 账号 | 用�?| 笔记 |
|---|---|---|
| `prod_iktl8t38` | 搜索对照（读者视角） | �?|
| `prod_iktlbmxk` | IK 验证作�?| 已删 |
| `prod_iktmli1d` | IK 复验作�?| 已删 |

笔记都走 `DELETE /api/note/{id}` 清掉了，ES 索引 `xk_note` 现在 0 �?（`docs.deleted` 计数会留着历史，属正常）。要彻底清账号得�?prod MySQL 手删�?
**P17~P22 的探针账号都已手删干净**，当�?prod 库里只剩上表那两个历史遗留的
`prod_iktl*`（各 0 篇笔记）�?2 条演示举报。规律：
**每轮探针的编号前缀（`prod17%` / `prod20%` / `prod21%` / `prod22%`）跑完立刻删**�?用第 8.8 节那个「按前缀�?user �?+ 派生表物化」的一条语句即�?—�?prod 是给人看界面的，别攒一�?`prod22amv24zx97` 这种账号�?
**P22 �?prod 真调用已�?27 �?*（走 nginx 18080）：规范化会话、未�?+1�?已读幂等、拉黑双向互禁与解黑恢复�?*P23 已部�?*（纯后端，prod 真调�?11/11�?造两条同龄笔记，一�?2 赞一�?0 赞，验证热度分排�?+ SQL 真的执行了）�?prod 部署顺序�?8.2 / 8.5 / 8.6�?先灌 `message_session` + `message` 两张表（**只有 node �?spawnSync 能让中文
COMMENT 字节原样送达**），再单�?build backend 镜像、重�?backend 容器�?**重启 nginx**�?.5：不重启�?502），最后前�?`--no-deps` 单独重建�?
⚠️ **验证排序的账号必须是「旁观者」，不能是作者本�?*：`pageDiscover` �?`n.user_id != #{userId}`（发现流不回显自己的笔记）。用作�?A 的身份去看，
A 自己发的高互动笔�?*根本不出现在结果�?*，症状是「高互动笔记没进流」—�?看起来像热度分没生效，真因隔了整屏。P23 第一次跑 prod 就踩了这个�?
⚠️ **计数是异步落库的**（P8 `NoteCounterFlushJob` �?30s）：刚点赞完立刻�?发现流，`note.like_count` 还是旧值，排序断言�?*假红**。造完数据要等
一�?flush 再断言，否则红的原因与代码无关�?
### 8.6 改后端时 `up -d --build frontend` �?*连带重建 backend** 而失�?
**现象**：只改了前端，跑 `docker compose -f deploy/docker-compose.prod.yml
--env-file deploy/.env.prod up -d --build frontend`，结�?Maven 报错刷屏�?构建失败 —�?而这�?*只碰了前�?*�?
**根因**：`frontend` �?compose �?`depends_on: backend`，`--build` 会把依赖图上
�?*全部**服务一起重建，于是也去�?backend �?`mvn package` 阶段，撞�?8.2 �?墙②（容器内连不�?Maven Central）�?*报错完全指向前端改动无关的东西�?*

**修法**：只改前端时单独构建 + 只重建前端容器：

```powershell
docker build -t xiaoku-frontend:latest frontend
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod `
  up -d --no-deps --force-recreate frontend      # --no-deps 是关�?```

`--no-deps` �?compose 不去�?backend。这�?8.1 是同一条教训的另一半：
**「只重建前端」在有依赖关系的 compose 里做不到，得显式�?`--no-deps`�?*

### 8.7 prod 验证别照�?dev �?DTO 字段�?
第一次跑 prod 探针，「举报笔记」两条断言红成 `100001 举报原因不能为空`�?真因不是 prod 配错了，�?*探针脚本把字段名写成�?`reason`（自由文本）**�?�?`ReportCreateDTO` 实际�?`reasonCode`（`@Min(1) @Max(6)` 的枚举）+
可�?`detail`�?
`100001` 来自 DTO 层的 `@Min/@Max/@NotNull`�?*不进业务�?* —�?�?P18 记的
「补充说明超 200 字返�?100001 而不�?80003」是同一形状�?*参数校验先于业务去重**�?所以「字段名写错」的报错也永远是 `100001`，不会告诉你是哪个字段�?
**判据**：prod 探针�?`100001` �?message 提到某个字段名时，先 `Read` 那个
DTO 确认字段名与约束�?*不要**怀�?prod 的数据或配置 —�?dev 契约测试
之所以没暴露，是因为它用的是同一�?DTO（前端已经写对了）�?
### 8.8 往 prod MySQL 灌清�?SQL：临时表**不跨连接存活**

�?5 节那�?`CREATE TEMPORARY TABLE _ct AS ...` + 后面十几�?`DELETE` 全靠它，
但那�?*同一个连接内**执行的。往 `docker exec -i ... mysql` 灌脚本时踩了两个坑：

1. **`CREATE TEMPORARY TABLE` 之后的语句报 `Table '_p' doesn't exist`**�?   临时表是**连接�?*的，`mysql` 客户端每条语句可能重开连接�?2. **�?`OR` 两侧各引用一次临时表�?1137 `Can't reopen table`**�?   而且**报错之前那几�?DELETE 已经执行完了**（半截清理）—�?   别以为整段没生效�?
**最省事的解法：临时表换成「按前缀直接�?user �?+ 派生表物化�?*，一条语句搞定，
不依赖临时表存活�?
```sql
DELETE FROM xiaoku_db.notification
  WHERE actor_id   IN (SELECT id FROM (SELECT id FROM xiaoku_db.user WHERE username LIKE 'prod21%') k)
     OR receiver_id IN (SELECT id FROM (SELECT id FROM xiaoku_db.user WHERE username LIKE 'prod21%') k);
DELETE FROM xiaoku_db.user WHERE username LIKE 'prod21%';
```

灌多�?SQL 时用 `Set-Content -Encoding Ascii` 落盘�?`Get-Content -Raw | docker exec -i ... mysql`（PowerShell 5.1 **不支�?* `<` 重定向给
原生命令，会�?`RedirectionNotSupported`）�?
### P24 移动端手感：manifest + 分享（本 commit�?
CDP **547 �?*�?37 + 10，ui-note 123�?33），契约�?**621**（纯前端）�?
**先量后�?*：动手前量了三个候选的真实使用量，结论推翻了直�?—�?**视频�?0 条数�?*（`LocalVideoStorage` 早就写好了，但全�?`video_url` 全是 NULL�?功能从未被人用过）。给一个没人用的功能做转码是投机，所�?P24 不做视频�?
#### manifest（可安装�?
`public/manifest.json` + `icons/`�?92 / 512 / maskable-512）。图标由
`scripts/gen-pwa-icons.mjs` 生成 —�?`public/` 里只�?webp 吉祥物，�?manifest
�?icon 需�?PNG�?*maskable 更是必须位图**（SVG 在多数平台不被接受）�?maskable 的主体比普�?icon **再缩一�?*（pad 0.28 vs 0.16）：系统会裁掉边�?10% 安全区，直接拿普�?icon �?maskable 用，Android 上会切掉小哭猫的脸�?
⚠️ **刻意不注�?service worker**：那会引入一整套缓存失效问题（HTML 缓存住旧
版本�?37 �?CDP 测试全部打到缓存的旧资源），而收益是「离线可用」—�?**这是一个必须联网的社区产品**。manifest 本身不依�?SW，它只影响「可安装」与启动画面�?
#### 分享（`composables/useShare.ts`�?
原生分享面板 �?复制链接降级。集中一层而不是每次调用处各写一遍，因为降级链条�?三个坑：

1. `navigator.share` 只在**安全上下�?*里存在，�?*桌面 Chrome/Edge/Firefox
   都没�?* —�?「有没有它」不能靠 UA 判断，必�?`typeof navigator.share === 'function'`�?2. �?`navigator.share` 必须�?*用户手势的同一 tick**里发起，一旦中�?await �?   一次，iOS 会抛 `NotAllowedError` —�?而症状是「点了没反应」，与真因隔了两层�?3. `AbortError`（用户点取消�?*不算失败**：这时降级到复制反而是错的，他明确不要分享�?
#### 两个�?TypeScript 抓出来的�?bug

1. **�?`await` 导致三元恒真**：`return copy(target) ? 'copied' : 'failed'` —�?   `copy()` 返回 `Promise<boolean>`，�?**Promise 对象永远为真**，于是复制失�?   也会提示「链接已复制」，用户点开发现是旧地址。TS2801 把它报成类型错误�?   实际是运行时 bug�?2. **`navigator.clipboard` �?lib.dom 里声明成非可�?*，所�?   `navigator.clipboard?.writeText &&` �?`if (navigator.clipboard)` 都会被判�?   恒真（TS2801）—�?而运行时�?*真的**可能不存在（非安全上下文的�?Safari�?   Firefox 的非 HTTPS 页）。用**局部交叉类�?*收窄成可选，而不是删掉判断�?
#### CDP 那两条断言为什么要**替身**而不是真�?
headless Chrome �?`navigator.clipboard.writeText` **权限默认被拒**
（reject，`execCommand('copy')` 兜底也返�?false），实测 toast 弹的�?「复制失败，请手动复制地址栏」。�?`navigator.share` 会弹**浏览器原生对话框**�?`Page.navigate` 会卡住等它�?
所以两条能力都换成可控替身�?*断言我们打算分享/复制什�?*，而不是断言浏览�?允不允许。把「复制失败」当成「分享失败」断言，等�?*�?bug 钉成契约**�?这条�?P12 记的「自�?accept 原生对话框」是同一个坑的两面�?
### P24 已知取舍

- **没有 service worker**，因此不能离线、也不能做「加到主屏后秒开」。见上�?- **没有下拉刷新**：iOS �?`overscroll-behavior` �?PWA 一起才完整�?  单独做会�?Android 上与系统刷新打架。留�?SW 那轮一起做�?- **分享不带图片**：Web Share API �?`files` 需�?`canShare({files})` 为真�?  而那要求�?fetch �?`File` 对象 —�?�?9 张图的笔记是 9 次请求，
  移动网络下得不偿失（且分享出去的大图会占用户流量）�?- **`useShare` 只接在笔记详情页**。作者主�?话题页的分享是「分享这个话�?这个人」，
  语义与「分享一条内容」不同，产品口径要单独定�?

**P24 已部�?*（纯前端，`docker build` + `--no-deps --force-recreate frontend`�?
prod 真调�?**13/13**：manifest/图标静态资源可访问且非空、maskable �?PNG 位图�?
`index.html` 挂了 `rel=manifest` �?`apple-touch-icon`、笔记详情数据链路没�?
这次前端重建搞坏）�?

⚠️ **验「prod 跑的是新前端」不能只比入�?chunk 的哈�?*：容器内自己�?
`npm run build`，Vite 输出的内容哈�?*不保证与本机 build 一�?*（本机入口是
`index-hrjK9BpF.js`，prod �?`index-Dww1rGtA.js`，两边都是对的）�?
可靠做法�?*�?prod 实际提供的懒加载 chunk**再查特征串：
从入�?JS 里正则出 `assets/NoteDetailView-[A-Za-z0-9_-]+\.js`，拉下来确认里面
含本轮的文案（本轮是「链接已复制」）。比哈希差一个数量级的排查成本�?

（「Docker Desktop 整个停掉时的症状」记在第 2.0 节，不在这里重复。）

### P25 创作端图片裁剪（�?commit�?
CDP **562 �?*�?47 + 15，ui-note 133�?48），契约�?**621**（纯前端，零后端改动）�?
**裁剪在本机完�?*（canvas �?Blob），**不上传原图再让服务端�?*：原图可�?10MB�?裁完通常 1~2MB，走本机既省流量也省服务�?CPU。而且「上传前能改」和「上传后能改�?是两种体�?—�?用户在发布页就已经知道自己要发什么，不该发出去再回来改�?
**支持的操作刻意只做两�?*：自由裁剪框 + 旋转 90°。缩�?滤镜是另一类东�?（要的是「渲染管线」而不是「取景框」），一起做会让这个弹窗变成一个半成品�?图片编辑�?—�?与其做半成品，不如把裁剪这件事做扎实�?
#### 四个被自己的测试抓出来的�?bug

1. **`object-fit: contain` 下不能用 `img.clientWidth`**。`.pic` 上是
   `width:100%;height:100%` + `object-fit:contain`，于�?clientWidth 返回的是
   **元素盒子**�? 舞台大小 480×420），而不是视觉内容占的那一�?   �?20×120 的图只占 384×209）。拿元素盒子当显示区，裁剪框的像素映射整体错�?—�?   症状是�?:1 裁剪出来是竖的」。正确做法是�?contain 规则自己�?   `scale = min(舞台�?图宽, 舞台�?图高)` 再居中�?2. **比例是「屏幕比例」不是「图像坐标比例�?*。直接在归一化坐标上�?`w = h / r`�?   屏幕上框的长宽比会等�?*图像�?*长宽�?—�?用户�?1:1，看到的是个 220:120 �?   扁框（实�?384×209）。要先算目标**屏幕尺寸**再反推归一化值�?3. **旋转不该丢掉用户选的比例**。原�?`rotate90()` �?`resetBox()`，而它�?   ratio 清零 —�?于是 1:1 的框变成「旋转后整张图的 80%」，裁出 96×176 的竖图�?   正确做法是旋转后 `measure()` �?`applyRatio()`�?4. **`URL.createObjectURL` 写在模板表达式里 = 每次重渲染新建一个且永不 revoke**�?   开一次裁剪框泄漏一份原图内存，肉眼完全看不出来。移到脚本里生成一次，
   并在 `onBeforeUnmount` �?revoke�?
（另�?`resetBox()` �?*不该**�?`rotate` —�?旋转是用户在**当前这张�?*�?已经做过的选择，换图时那一次重置由 `loadImage` 显式调用。之前两处都写在里面�?连写三行补偿代码，第二次点旋转永远得�?90° 而不�?180°。）

#### EXIF 方向：不做这一步就是「竖着裁、出来是横的�?
手机拍的竖图，`<img>` 会按 EXIF 自动旋正，但 **canvas 读到的原始像素是躺着�?*�?本组件扫 APP1 段拿�?orientation�?/8 = �?90°�?/4 = �?180°），**画进 canvas
再转**，而不是去�?EXIF 标记 —�?浏览器对 `createImageBitmap` �?imageOrientation
支持并不一致，靠不住。解析失败就按原图走：少转一次不会丢内容，转错了才会�?
#### 裁剪按钮的热区：24px 视觉 + 40px 透明热区

同一个小格子里已经有 20px 的删除钮，裁剪钮给足 40px 会和�?*互相压住**
（算过：两个热区圆心距只�?87.7px，虽然不压但已经很挤）。折中：视觉 24px�?�?`::before` 撑一�?*透明�?40px 热区** —�?不改布局、不吃掉删除钮的点击�?断言也要分清�?*量视觉盒�?�?0px + �?`::before` �?�?0px**，只量视觉盒子会误报�?
#### 测试基建：新插入的段落要**还原页面位置**

裁剪段落结束时页面停在「刚发布的裁剪笔记」上，而下面第 16 段清理靠
`location.hash` �?id 去删**长正文笔�?* —�?不还原的话它会删错对象，
真正该删的那篇永久留在库里。症状是清理断言报「元素为 null」，与真因隔了整段�?所以新段落开头要**先记�?id**，结尾删掉自己造的笔记并导航回去�?
（另：`[data-test=crop-ratio-1:1]` **不是合法选择�?* —�?冒号�?CSS 里是伪类前缀�?
`querySelector` 对它**抛异�?*而不是返�?null，所�?`?? fallback` 根本轮不到执行�?
带引号写�?`[data-test="�?]` 才合法。）

**P25 已部�?*（纯前端，`docker build` + `--no-deps --force-recreate frontend`�?
prod 真调�?**9/9**：注�?上传 220x120 裁剪结果/无图发布仍被�?100001（P11 规则
没被前端改动影响�?带图发布/详情封面就是刚上传那�?发现流仍可用/删除�?20001）�?
探针�?`prod2%` 前缀清干净�?

验「prod 跑的是新前端」用的是 P24 段那条：**�?prod 实际提供的懒加载 chunk
再查特征�?*（`PublishView-*.js` 里含「裁剪这张图片」）。本轮同时确认了
`NoteDetailView-*.js` �?P24 的「链接已复制」、P21 的「这篇笔记的操作」仍在，
以及 `manifest.json` �?200 —�?前端重建**没有把之前几轮的产物带掉**�?

⚠️ 纯前端轮次也要验�?*旧的东西还在**」，不只验「新东西在」：
一�?`docker build` 会重跑整�?Vite 构建，如果某轮加了新组件但忘了把�?
`import` 进去，旧 chunk 仍在而新功能不生�?—�?只查新特征串会以为部署成功�?
### P26 滤镜（本 commit�?
CDP **571 �?*�?62 + 9，ui-note 148�?57），契约�?**621**（纯前端）�?
「裁剪」升级成**编辑�?*（裁�?/ 滤镜两个 tab）：它们改的是同一张图的同一份像素，
分成两个弹窗意味着「裁完想再调个滤镜」要退出重进一次�?
#### 滤镜 tab **不显示取景框**

显示它会让用户以为「框外那圈也会被处理」，于是有人为了「不裁到脸」特意把框挪开
—�?而滤镜是�?*整张**图生效的，界面上就不该出现裁剪暗示�?
#### ⚠️ 「只想加滤镜」不该被静默裁一�?
滤镜与裁剪走**同一条渲染路�?*，所以加�?`cropTouched`：只有用�?*真的**调过
取景�?/ 选过具体比例 / 转过图才裁。症状极隐蔽 —�?图看起来「就是小了一圈」，
而用户根本不知道自己裁过，也就不会怀疑是哪里出了问题�?
（「点『自由』不算动过」：那是**取消**比例约束，不等于想裁。）

#### ⚠️ 预览与导出必须逐像素一�?—�?这是滤镜正确性的�?
预览�?CSS `filter` 属性（GPU、实时、零像素开销），导出�?canvas 逐像素数学�?两条路径各写一遍数学就一定会漂，�?*用户看到「预览很黄、发出去是白的」时
不会怀疑滤镜，只会以为平台坏了**�?
所以契约里钉了一条：同一张彩色测试图，CSS 滤镜结果�?`applyFilterToPixels`
结果**逐点比较**（�? 舍入误差）。这条断言当场抓出两个�?bug + 一个脚本自身的 bug�?
1. **`hueRotate` 的尺度错�?*。入参是 0..255，中间量（v/c/m）也�?0..255�?   返回时又多乘了一�?255 —�?「冷调」maxDiff �?**254**（颜色量级翻了几倍）�?2. **精确 HSV 往�?�?CSS 的矩阵近�?*。改掉尺度后仍差 18。CSS `hue-rotate()`
   �?SVG 规范走一�?**3×3 矩阵近似**；这里刻意采�?*近似的那一�?* —�?   宁可数学上不精确，也要与浏览器逐像素对齐�?3. **`grayscale(0.3)` 是�?0% �?+ 70% 原图」不是完全变�?*。早期版本直接全�?   再叠 sepia，「胶片」差 122 —�?而且**单独�?grayscale 是测不出来的**�?   必须测组合（这正是「单独测每个原语都过、组合才炸」的典型）�?4. ⚠️ **验证脚本自己错了一�?*：两条路径的「我的实现」那份数据，是从**已被
   `ctx.filter` 处理过的 canvas** 取的，等于把滤镜应用了两�?—�?于是�?   `brightness(1.06)` 都「差 14」。�?`grayscale(1)` 因为「灰度再灰度还是灰度�?   **碰巧通过**，掩盖了脚本自身的错�?   **教训：验证脚本的 PASS 也要看「它有没有可能恒真�?*�?   �?P14 那条「若它红说明用例失去区分力」互为镜像�?
#### 刻意不用 `ctx.filter` 做导�?
Safari �?`canvas.filter` 的支持来得很晚（16.4 才有）。逐像�?JS 循环�?1600×1600 上约 20~40ms，换来的�?*跨浏览器一�?*�?
#### 两处刻意不做�?
- **强度调节滑杆**：六套预设已经覆盖「想要某种调子」，
  滑杆要的是一套参�?UI 与持久化，而自由调节很容易被调成「看不出原图」�?- **滤镜顺序可换**：`sepia �?saturate �?brightness` 与另一种顺序结果不同，
  但让用户去理解「先降饱和再提饱和」没有意义；固定顺序并写在预设里更可控�?
#### 测试基建（又一次同一个坑�?
本段结束时页面停�?*发布�?*，而下一段清理要�?*详情�?*点删�?—�?不还原的�?`note-delete-btn` �?null，报错「Cannot read properties of null�?与「页面走错了地方」毫无关系。这�?P25 刚踩过的**同一个坑的第二次**�?新增段落必须还原页面位置，否则下一段的元素假设全部落空�?

### P27 service worker + 下拉刷新（本 commit�?
CDP **582 �?*�?71 + 11，ui-smoke 31�?2），契约�?**621**（纯前端）�?
#### ⚠️ service worker 只在**生产构建**注册 —�?这不是优化，是保�?
`registerServiceWorker()` 里第一行就�?`if (!import.meta.env.PROD) return`�?开发时注册会让**全部 582 �?CDP 测试打到缓存里的旧资�?*：改了一�?CSS �?测试量的是上一轮的布局，于是「刚改好的东西莫名其妙又坏了」—�?而症状在 UI 上、真因在浏览器缓存里�?*隔了整整一�?*，不会有人往 SW 上想�?
所�?`ui-smoke` 里有两条**不是功能断言、而是守住整套测试有效�?*的断言�?「开发时没有注册 service worker�?「开发时没有建立任何缓存桶」�?
#### 缓存策略刻意分三类（不是「一�?cache-first」）

| 请求 | 策略 | 理由 |
|---|---|---|
| 导航（HTML�?| **network-first**，离线回落缓�?| HTML 里引用的�?*带内容哈希的** chunk 名；缓存�?HTML 就会去请求已不存在的�?chunk�?04 白屏�?|
| `/assets/xxx-[hash].js` | cache-first | 内容变了文件名就变，缓存**永远是对�?* —�?唯一可以放心缓存的一�?|
| `/api/`、`/static/` | **完全不碰** | API 响应是动态的，缓存它等于让用户看到过期数�?|

**版本�?*：`VERSION` 每次发布 bump，activate 时清旧缓存。不 bump 的话
用户会永远卡在第一次装的那个版本上�?
⚠️ `install` 里的 `cache.addAll()` 也要留意�?*单个资源 404 会让整个
install 失败、SW 永远装不�?*，所以只 precache 三个必定存在的壳子�?
#### 下拉刷新：自己实现，不用浏览器的

自带的会显示浏览�?UI，且�?Android Chrome 上与系统手势/滚动惯性打�?（表现是「有时候弹出来有时候不弹」）。自己实现还能把触发条件收紧�?�?*列表页顶�?*」—�?给每个页面都加会让「在页中间一拽就刷新」到处发生�?
四条容易漏的�?- 触发条件�?*位置�?0 + 方向向下 + 位移过阈�?*，少「位置为 0」那条，
  用户在页中间想刷新一下就会把整个页面往下拽�?- 移动时必�?`preventDefault()`，否则移动端浏览器接管成原生下拉刷新�?  于是**我们的指示器与浏览器的同时出�?*（用 `passive: false` 才拦得住）�?- 位移�?*阻尼**（`dy * 0.5`�? 上限，模拟原生那种「拉不动」的手感�?  否则能把内容拽出屏幕�?- `overscroll-behavior-y: contain` �?*全局样式**，`onBeforeUnmount`
  里不还原就会污染整个应用（详情页/发布页的下拉手感全被改了）�?  `ui-smoke` 有对应断言：离开首页后必须不再是 `contain`�?
#### 指示器不能挡点击

`position: fixed` + `pointer-events: none`。放在文档流里的话它会把下面的内�?顶下去，而内容一变位置，用户点的就是另一个东西了。位移直接绑在下拉量上�?不加过渡 —�?加了反而有「手指已经停了、指示器还在追」的滞后感�?
旋转动画�?`prefers-reduced-motion` 关掉（P13 那条无障碍原则的延伸）�?
#### 测试基建：新段落要知�?*页面当时在哪**

`ui-smoke` 的注�?校验用例把页面停�?*登录�?*，而未登录访问 `#/` 会被守卫
弹回 —�?于是 `waitFor` 超时报的是「首页终态」，与「页面根本不在首页�?隔了好几行。补一�?`loginDemo` 才对�?

**P26/P27 已部�?*（纯前端，`docker build` + `--no-deps --force-recreate frontend`�?prod 真调�?**11/11**：`sw.js` 可访问且 **Content-Type �?JS**（返�?text/plain
会被浏览�?*拒绝注册**，症状是「SW 装不上」）/ `sw.js` �?`/api` 明确不碰 /
`install`+`activate`+`fetch` 三个监听都在 / 发现流仍可用 / P24 �?manifest �?apple-touch-icon 仍挂载）。探针按 `prod2%` 清干净�?
验「prod 跑的是新前端」按 P24 段那条抓 chunk 查特征串：P26 �?`PublishView-*.js` 含「裁剪这张图片」（P25）与滤镜预设「胶片」；P27 �?`HomeView-*.js` 含「松手刷新」—�?三轮的特征串都在，说明前端重建没有把之前
几轮的产物带掉�?

### P28 评论操作�?+ 「⋯」去胶囊（本 commit�?
CDP **587 �?*�?82 + 5），契约�?**621**（纯前端）。来�?2026-10-11 的五条手测反馈里的两条�?
#### �?发表按钮挪回输入框右边，**推翻 P21 的决�?*

P21 曾经特意�?`.c-send` �?`.input-row` 搬进�?，理由写得很清楚：它原来
**绝对定位**压在胶囊右下角，只靠 `padding-right: 56px` 让位，�?56px 恰好
等于按钮宽度 —�?textarea 超过 `max-height` 内部滚动后，滚出来的行直接走�?按钮底下（用户说�?输入时遮�?）�?
**这次的问题是摆放方式而不是摆放位�?*：改�?flex 兄弟节点（输�?`flex:1`�?按钮 `flex:0`、间�?8px）后，胶囊自动收窄，两�?*根本不重�?*，P21 那个 bug
从根上不存在。而写在输入框右边也符合直�?—�?"写完顺手点发�?是大多数人的
动作顺序。实�?430 视口：输�?336px / 按钮 62×44 / 间隙 8px / 底边齐平 Δ0�?
按钮同时�?*纯图�?*（`van-icon name="arrow"`）改�?*可见文字「发送�?*—�?图标看不出这是什么�?
规格跟着改，**不要保留旧断言**：原来的「行1 输入框通栏 �?80px」「发表钮贴栏
**�?*缘」两条已经不成立（右侧让给了按钮）。新规格钉三件事�?
1. `sendGap >= 0`（输入框右缘到按钮左缘）—�?**P21「输入时遮挡」的回归钉子**
2. 按钮 �?4×44 �?`sendRight` 对齐 **`.bar-row` 的右�?*
3. 输入框宽�?�?00px（实�?336；旧版挤�?~170px�?
⚠️ **贴边要对�?`.bar-row` 的右缘，不是 `.actionbar` �?border box** —�?后者含左右�?12px 内边距，�?24px。第一版拿 `barLeft + barWidth` 比，
症状是「断言�?12」，看着像布局没贴齐，其实参照物选错了�?
#### �?「⋯」去掉胶囊外�?—�?但热�?*没有**�?`::before` �?
用户反馈"每一条评论的 ... 圆形按钮做的很突兀"。`.more-btn` 原来�?`border-radius:999px` + `border` + `background` 的胶囊，每条评论立一个小圆饼�?
第一版照�?P25 裁剪钮的做法（视�?20×20 + `::before` �?40×40 透明热区），
**两个症状都被布局审计抓出�?*�?
- 元素自身 `scrollWidth 30 > clientWidth 20` �?判成溢出
- 伪元素两侧各伸出 10px，顺带把父级顶栏撑成 `header.top scrollW 1146 / clientW 1136`

两个都指�?布局坏了"，与「我只是加了个热区」隔了整整一层�?
**正解：热区直接放在盒子上�?* `min-width/height` 保持 40px —�?�?P28 之前
**完全相同的占位，布局零变�?*。看起来是裸的「⋯」，手指目标仍是 40px�?不画框、不画底色，就这两行的事�?
> 因此 **P25 裁剪钮那条「量视觉�?�?0px + �?::before �?�?0px」不能推�?* —�?> 那个做法只在裁剪钮所在的 `.cell` 里成立（父级 overflow 挡住了外溢）�?> 同一个形状搬到别处就会把父级撑破�?*先问：这个父级挡不挡�?*

#### �?测试基建两个�?bug

**A. `ui-follow` �?`finallyCleanup` 从来没被执行�?—�?每跑一次漏一条拉黑�?*

数组�?L27 声明、L396 push，但 `finally` 块里只有 `s.close()`�?*没人排空**�?后果不是「本组下次红」而是**别的组红**：`user_block` �?*双向生效**的（P18），
拉黑后被拉黑者的笔记�?*所有人**不可见，于是关注流空、搜不到、作者主页笔�?列表�?—�?每组症状都指向自己的功能�?*没有一条提到拉�?*�?
实测：残留一�?`xiaoku_demo �?xk_ui_follow` 时，**follow / search /
notification 三组同时�?*（follow 43/48、search 13/14、notification 19/26）�?清掉残留后三组立刻全绿。AGENTS P21 记过一次「三个组同时变红」，当时归因�?「手测点过拉黑」—�?*现在知道那个判断是错的，真因是这个洞**�?
规矩不变（P15 早就写过）：**三个以上不相关组同时红，先查全局状�?*
（`user_block` / `user.status` / `note.status`），别逐个组去调断言�?
清理顺序�?*先排空再 `s.close()`**。清理是浏览器内 fetch，会话关了之后执�?就静默失败且**不报�?*�?
**B. `ui-layout-audit` 的注入脚本在模板字符串里，注释里不能用反引号�?*

那段 `.map(el => ...)` 会被 `evaluate` 进浏览器，所以整个函数体是一个模�?字符串。我在注释里写了 `` `::before` ``，一个反引号就把模板提前闭合，报出来�?`SyntaxError: Unexpected token ':'` 指向**注释�?*，与「我写了反引号」隔了一层�?改用 `::before` 不带引号、字符串拼接代替嵌套模板�?
⚠️ 更阴的是：`node --check` 会红，但**报错行号指向注释**�?所以「改注释」看起来像在修一个语法错误，实际要改的是代码里的引号�?
#### �?断言放哪：`!c.mine` 是渲染前�?
评论行的 `MoreSheet` 渲染条件�?`v-if="!c.mine"`。�?**ui-note 全程给自己的
笔记评论、ui-interaction 切到 xk_ui_interact 后也是给自己的评�?* —�?两处
�?`miss:true` 白红三条。库里也**没有**天然 fixture（`xk_ui_follow` �?5 �?笔记下没有他人评论；唯一有的是手测留下的数据，会被删）�?
所以样式断言�?`ui-follow` �?*作者主�?* —�?同一�?`MoreSheet` 组件�?同一�?`.more-btn` CSS，且那里�?�?**无条件渲�?*。评论行「他人评论才�?⋯�?这个行为�?P21 的举�?拉黑用例覆盖�?

### P29 @ 提及候�?+ 评论里的 @（本 commit�?
契约 **673** 条（621 + P29 �?15 + **P22 段首次真正执行的 37**），
CDP **595** 条（587 + 8，ui-interaction 67�?5）。来�?2026-10-11 手测反馈两条�?
#### ⚠️ 两条反馈的真因都和「以为的那样」不一�?
**�?「@ 什么都没有，没有候选列表�?* —�?真缺口：后端**没有「搜用户」接�?*
（user controller 只有 register/login/me/refresh）。新�?`GET /api/search/user?keyword=`�?
**�?「@ 对方后对方后台没有任何提示�?* —�?⚠️ **不是通知坏了**�?查库发现用户测试的那两条通知 `type=2`（评论）而不�?`type=6`（提及）�?**是在评论�?@ �?*，�?`note_mention` 表原�?*只有 `note_id`**�?评论里的 @ **根本没有实现**（`CommentServiceImpl` 一�?mention 调用都没有）�?只有笔记正文里的 @ 才走 `TopicRelationServiceImpl` 发通知�?
所�?P29 要做的是：搜用户接口 + @ 选择�?+ **评论 @ 全链�?*（解�?关系�?通知/渲染）�?
#### 三个设计决定

1. **搜索昵称与用户名都匹配，但插入的永远是用户名�?* 用户在界面上只看得见
   昵称（「关注搭子」），要 @ 对方得打 `xk_ui_follow`。只搜昵�?�?用户搜到�?   却插进一串英文；只搜用户�?�?用户根本不知道那串是什么�?*两个都搜**�?   插入用用户名是因为它**唯一**（`nickname` 没有唯一索引，库里就�?3 个重名）�?2. **候选自动排除自�?/ 拉黑（双向）/ 已注销 / 已禁用�?* 不在前端再过滤一�?—�?   两处规则一旦不同步，就会出现「候选里有但 @ 出去解析不出来」的鬼影�?   �?*界面看不出异�?*�?3. **`comment_id` �?0 哨兵而不�?NULL�?* MySQL 唯一索引�?NULL �?NULL
   **互不相等**，`UNIQUE(note_id, comment_id, user_id)` �?comment_id �?NULL �?   �?*放行任意重复的正文提及行**，去重直接失效�?
> ⚠️ **存量库要手动 ALTER**（`schema.sql` 只在新库初始化时跑）�?> `ADD COLUMN comment_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER note_id`
> �?`DROP INDEX uk_note_mention` �?`ADD UNIQUE KEY uk_note_mention(note_id, comment_id, user_id)`�?> 旧行会自动回�?0，无需数据迁移�?
#### MENTION 通知必须�?targetId

`notifyMention` �?`target_id` �?noteId。评论提及如果也�?noteId，会出两个问题：
�?同一人在同一篇笔记上「正�?@ 一�?+ 评论 @ 一次」撞 `uk_notify_once` 去重键，只剩一条；
�?**删评论时撤不�?*（撤的是 noteId，会把正文那条一起撤了）�?所以新�?`notifyCommentMention`，`targetId = commentId`，两类来源各自独立�?
#### 前端：一个组�?+ 一�?composable

`MentionPicker.vue` + `useMentionPicker.ts`，发布页与评论区**共用**
（复制两份的必然结果是一处改了另一处没改，而症状是「发布页能选中�?评论区不能」，没有报错）�?
⚠️ **textarea 会吞�?Enter/Tab**（它们是「换�?移焦点」，不冒泡）�?所以「候选开着时按回车选中」必须在 textarea 自己�?`keydown` 里转发，
不能挂在根节点监听器上�?
⚠️ **插入是「替换」不是「追加�?*：用户已经打�?`@关`，选中的应该是
`关注搭子`，追加会得到 `@关@xk_ui_follow`，服务端解析出的用户名是「关」�?
#### ⚠️ 测试基建：`check()` �?return，导�?**P22 整段从未执行�?*

```js
function check(name, condition, detail) { ... }   // �?没有 return
if (!check('前置', cond)) { 跳过 } else { 真正的断言 }
```

`check` 返回 `undefined` �?`!undefined` 恒为 true �?**「跳过」分支永远被选中**�?`else` 里的断言一次都没跑过，而汇总照样显示全绿�?
**症状极具迷惑�?*：段首那�?PASS 正常打印，后面一条都没有�?总数只多了段首那一条的数量。P22 私信段当�?*只贡献了 2 条断言**�? 段首两个 check），
�?P22 的文档写的是�?2 条」—�?那个数字当时就被误当成合理了�?
修成 `return !!condition` 之后，P22 �?*第一次真的执�?*，立刻暴�?5 条红�?
| 症状 | 真因 |
|---|---|
| 拉黑互禁两条期望 50004 实得 0 | **段落里根本没有「创建拉黑」这一�?*，只有结尾的 `del`。结构上就不可能通过 |
| 「不存在会话 �?50005」实�?0 | 两个 fixture 之间**已经�?53 条私�?*（ui-message 每轮都在发），拿有会话的组合去断言 50005 永远拿不到。改用第三个从未通过私信的账�?|
| 「聊天记录按时间正序」期望与实际**打印出来一模一�?*却红 | `eq` �?`===` 比较，而两个内容相同的**数组引用也永远不相等**。要比数组必须比 JSON �?|
| 「我收到的那些被标已读」得�?`[0,1]` | 最后两条里「第一条」是 M1 **自己发的**（对 M2 未读），「回复」才�?M1 收到的。断言忘了�?`senderId` 过滤�?*与它上一行「不能替对方点已读」自相矛�?* |

⚠️ 这四�?*都是测试自己的错，不是产品缺�?* —�?改的是断言与流程，
不是实现�?*规矩不变：新增用例一律自建数据，不复用前面段留下什么�?*

#### 我自己也踩了同一个「口令抄错」的�?
P29 段里�?`xk_ui_smoke` 的口令写�?`Xk@2026peer`（实际是 `Xk@123456`）�?后果**不是「登录失败」这么直�?* —�?拿到的是 `undefined`，于是后面每一�?请求都带着 `Bearer undefined` 去打，全部返 10005/10006「凭证无效」，
整段假红�?*症状完全指不到原�?*�?
四个常驻 fixture 的口�?*各不相同**，抄之前先确认：
`xk_ui_smoke` = `Xk@123456`；`xk_ui_follow` / `xk_ui_interact` /
`xk_ui_admin` = `Xk@2026peer`�?
#### P29 段自己踩的两个探针坑（不是产品问题）

1. **`LoginVO` 里没�?userId**，拼�?`/api/note/user/undefined` 时后端返
   `100404 接口不存在`，与「这个接口坏了」长得一模一样。取 id 只能�?`/api/user/me`�?2. **通知列表�?PageVO**（`{list,total}`）不是数组，直接 `data.find` 会报
   「list.find is not a function」�?3. `el.click()` 只派�?`click` 事件�?*不派�?`mousedown`** —�?而候选面�?   �?`mousedown` 抢在 blur 之前。但这也意味着**读屏软件只派�?click 时功能失�?*�?   是真的无障碍缺口。两个都�?+ 400ms 去重窗口才既防抖又覆盖读屏�?4. **断言「链接文字是用户名」是错的**：`mentionNodes` **有意**�?`@用户名`
   显示�?`@昵称`（正文可读性更好），链�?href 才对。改的是断言不是实现�?

### P30 @ 提及机制重构（本 commit�?
契约 **674** 条（673 + P30 �?1），CDP **600** 条（595 + 5）�?
**起因是用户实测发现两件真�?*：① �?`@` **什么都没有**；② 手打 `@关注搭子`
**对方毫无反应**。查下来三处都是我的实现问题，其中一处是**测试假绿**�?
#### 一、主因：候选面板在桌面端被推到屏幕�?
`.picker` �?`position:absolute`，而父容器 `.bar-input`（详情页）与 `.field`
（发布页�?*都没�?`position: relative`**。于是定位参照系一路上浮：
桌面�?`.actionbar` �?`position:static`（P25 撤掉吸底壳时改的），
参照系落�?*初始包含块（整个视口�?*，`bottom: calc(100% + 4px)`
把面板放在视口顶边之�?—�?**元素�?DOM 里，完全看不�?*�?
移动端因�?`.actionbar` �?`fixed`，面板勉强落在吸底栏上方，所以「有时能看见」�?
> ⚠️ **这就是「假绿」的典型**：旧断言�?> `waitFor("document.querySelector('[data-test=mention-picker]')")` —�?> 只查**元素在不�?DOM �?*。被推出屏幕的元素照样「存在」，所�?75/75 全绿�?> 而用户打开页面根本看不到�?>
> **以后任何浮层/面板类断言都不能只�?querySelector**，必须量
> `getBoundingClientRect()`：矩形在视口内、有面积、横向与触发元素对齐�?
#### 二、敲 `@` 不打任何字时**什么都不出**

`query` 为空�?�?后端返回空列�?�?面板不渲染。而小红书�?*敲完 @ 立刻出候�?*�?旧用例敲的是 `@xk_ui_inte`（带前缀），**永远走不到这条路�?* —�?而我在给用户的体验说明里恰恰让他「打一�?@ 然后停下」，正好命中�?
后端改为：空关键词返回�?*我关注的 + 我的粉丝**」，按粉丝数降序，去重，limit 8�?去重是必须的：互相关注的人在两个集合里各出现一次，不去重会出现连续两行同名同头像�?
#### 三、手�?`@昵称` 解析不出�?�?**改成「id 才是事实�?
原设计是**服务端解析正文里�?@**。但**昵称允许重复**，解析文本就必须�?「两个都叫『改名了』」时挑一�?—�?而挑错人比不 @ 更糟（通知发给了完全无关的人）�?
**采纳小红书的做法：选人那一�?userId 就定了，正文里的 `@昵称` 只是装饰�?*

| | 改前 | 改后 |
|---|---|---|
| 提及从哪�?| 服务端解析正�?| 前端提交 `mentionUserIds` |
| 插入正文 | `@用户名` | `@昵称`（用户名不再暴露�?|
| 手打 `@昵称` | 静默失败 | **失败 + toast 明确告知** |
| 同名歧义 | 挑错�?| **不存�?*（重名直接不匹配�?|

DTO �?`mentionUserIds: List<String>`（字符串是因为雪�?ID 精度，AGENTS �?6 节）�?`IdListUtil.parse` 转换�?*非法值静默丢�?*而不是抛异常 —�?用户可能打好字才
遇到对方注销，为一个已经注销的人发不出评论是很糟的体验�?
**`#话题` 仍走文本解析**：话题名天然唯一，没有消歧问题。只把「提及」切出去�?
#### ⚠️ 删掉 `@` 文本要能让提及失�?—�?按文本判断是**不够�?*

用户先用候选选了「互动搭子」，随后把那段删掉�?*又手打了一遍同样的�?*�?若提交时只判断「正文里还有 @昵称」，**手打的那次会被算成提及成�?* —�?请求体里 `mentionUserIds` 非空，从外面完全看不出问题�?
改成**插入时记下位置，提交时核对那个位置上仍然是我插入的那一�?*�?
> ⚠️ 中途我先试过「在 `onDraftInput` 里按文本剪枝」，剪枝写了却不生效 —�?> 因为无论是我插的还是用户手打的，正文里都找得到这个词�?*文本比对
> 根本无法区分**。这两条路径都在 `unresolvedMentions()` 里注明了�?
#### 四、用户名从界面上消失

决策：用户名退回为**纯登录标�?*，界面上不再出现�?移除 `UserView` / `ProfileView` / `HomeView` / `FollowListView` /
`BlockListView` / `MentionPicker` 里那一行；**`AdminView` 保留** —�?运营排查问题需要唯一标识，两个人都叫「改名了」没法查（已与用户确认）�?
于是 `username` 彻底不再需要用户记�?—�?这正好解答了用户最初的疑问
「为什么要同时设计昵称和用户名，小红书也是这么做的吗」（答案：小红书不是）�?
⚠️ 三条既有断言随之失效并已改掉：`ui-follow`「作者主页展示用户名」�?`ui-profile`「显示用户名」、以�?P13 那条基于 `.username` 的尺寸断言�?
#### 五、渲染侧要兼容同名与历史数据

`mentionNodes` 的映射从 `Map<string, MentionVO>` 改成
`Map<string, MentionVO[]>`，匹配时**消费**已用过的条目�?两个都叫「改名了」而都 @ 了时按出现顺序分配，否则第二�?@ 同名的人
会渲染成第一个人的链�?—�?**点进错误的主�?*�?
同时**昵称与用户名都要建键**：P30 起新内容写昵称，�?*历史数据**写的�?用户名，只建昵称键的话老笔记里�?@ 全部渲染成纯文本 —�?界面看不出异常�?
#### 六、`check()` 的教训第二次应验

本轮 P29 段与 P22 段新增断言时，我把 `s.check(...)` 当成了无返回值使用；
上一轮刚修过 `check()` �?`return` 导致 P22 整段从未执行的问题�?本轮所有新增用例都�?`if (!check(...))` 之外，避免重复踩坑�?
#### 七、顺带清掉的测试基建问题

- **`loginDemo` 在非首页调用时会死锁**：已登录状态访�?`#/login` �?`guestOnly`
  弹回，报「超时：演示账号按钮」，看起来像登录接口坏了。修法：goto 应用域名 �?  �?token �?�?goto 登录页（⚠️ **必须先导�?*，`about:blank` 是不透明源，
  �?localStorage 直接 SecurityError）�?- **`waitFor('comment-item')` 在上一条还在时立刻通过**：与 P11「同拍短读�?  同类。改成等**评论�?+1**�?- **诊断代码 hook 错了对象**：axios �?XHR 不走 fetch，第一�?hook `fetch`
  导致诊断值恒�?null，于是又开始怀疑产品代码�?

### P31 私信对齐小红书（�?commit�?

契约�?**674**（纯前端，零后端改动），CDP **632** 条（600 �?632：ui-message 20�?2�?
layout 139�?39 内部改断言口径但条目数不变）�?

**要解决的是「能聊天」与「像 IM」之间的差距**。P22 做完私信时是「能发」的标准�?
但那更像一个留言板：没有日期线、没有头像、没有时间戳、历史超�?50 条看不到�?
发失败就消失、没有表情�?

#### 四个真缺陷，每一个都是布局 bug 而不是功能缺�?

1. **「加载更早」写�?`v-if` + `v-else-if="list.length"`，导致有更多历史时整屏消息消�?*�?
   症状是聊天页只剩一个「加载更早的消息」按钮、一条消息都没有 —�?
   **与「消息没加载出来」完全一�?*，极难归因�?
   「加载更多」与「列表」是**上下两个东西**，从来不是互斥分支�?
   这条�?CDP �?2 段的既有 `waitFor` 超时抓到的�?

2. **加载更早的滚动补偿，连跑绿、单跑红**。三步才修对�?
   - 第一�?`scrollTop = scrollHeight_new - scrollHeight_old + scrollTop_old`�?
     `nextTick` 之后浏览器还没排版，量到的是旧高度，**补偿量恒�?0**�?
     修法�?`rAF × 2`（一轮布局 + 一轮绘制）之后再量�?
   - 第二版改成抓「插入前的第一条消息」的 DOM 引用，量它的 `offsetTop`�?
     **Vue �?key 复用 `<li>`**，unshift 之后同一�?DOM 节点承载的是另一条消息，
     量到的是「新那条」的位置，补偿量正好差一半（CDP 实测�?2396px）�?
   - 第三版回到高度差，但**基线必须在响应到达后、插入之�?*量�?
     请求在飞的几百毫秒里 5s 一次的轮询可能刚好追加了新消息�?
     于是补偿量少算约 5900px —�?症状是「单跑通过、全量连跑失败」，
     这正�?P12 记的「环境导致的 flake」那一类，必须往「是不是有真实缺陷」上查�?

   ⚠️ **验证补偿逻辑真的在干�?*：用户停在最顶时 `scrollTop=0`，有没有补偿都一样，
   所以那条断言**验不�?*。必须补一�?*滚到中间**的情�?—�?
   关掉补偿�?`dy=5747 / inView=false`，断言确实会红�?*PASS 也要看「它有没有可能恒真」�?*

3. **断言「仍是第一条」方向错�?*。用户本来就停在最顶，加载更早之后新历史出现在
   �?*上面**，它当然不再是第一�?—�?那正是应该发生的事�?
   要钉的是「那条消�?*仍在视口�?*」�?
   同理不能�?`scrollTop` 绝对值（列表�?30 条涨�?60 条时它必然变化）�?

4. **发失败弹 toast 就消�?*。私信发不出去是最让人无力的场景，
   让用户重打一�?500 字比多一句解释糟糕得多。改�?*失败气泡留在原地**�?
   虚线�?+ 标红 + 原因 + 「重新发送」，点一下原样再发�?
   ⚠️ 虚线是关�?—�?浅红底在琥珀气泡旁边几乎看不出来�?

#### 表情面板：Vant 没有这个东西

查过 `vant/lib/index.css`�?*没有** `van-emoji` / `van-emoticon` 规则
（`van-icon` 只是图标字体，里面只有箭�?星星/垃圾桶那�?UI 图标）�?
所以自�?`EmojiPanel.vue`，而不是引一个只为这一个面板的依赖�?

- **刻意不用 emoji 连字簇（ZWJ 序列�?*：`👨‍👩‍👧‍👦` 由多个码�?+ 零宽连接符组成，
  算「删掉一个表情」的长度时极易错位（一�?emoji 可能�?7+ �?UTF-16 单元）�?
  这里全是单码点或成对符号�?*一个表情恰�?1~2 �?UTF-16 单元**，可预测�?
- 热区 44×44（P13 下限�? `active` 缩放反馈�?*必须抑制
  `-webkit-tap-highlight-color` 的半透明�?*，它盖住 emoji 的黄�?
  按下去整张脸变灰，看起来像「表情坏了」�?
- 刻意不做：自定义表情上传（账号级资产）、表情商店、搜索表情�?
  三者都要服务端支撑，与「能和对方聊起来」正交�?

#### 两个新加�?data-test 是有代价�?

`message-row-*` 取代�?`message-bubble-*`，因为气泡被拆成「行 = 头像 + 气泡 + 时间戳」�?
**刻意不同时保留旧�?*：留着两套名字会让「哪套是当前契约」变得不确定�?
而这个文件里所有断言都该指向同一�?DOM�?

⚠️ 改完 data-test 之后�?*几何断言的量法也得跟着�?*�?
原本�?`.bubble` �?left，加了头像之后要�?*行内�?`.bub`** —�?
量整�?`.row` 的话两侧 left 都是 54（那�?padding），断言会恒红�?
�?`74x20` 那条热区假红也是同一类：P30 加了 `.mention`（正文里�?@提及链接），
`smallTargets` 的名单没同步，于是详情页每轮都报两条�?
⚠️ **行内文字链接不该�?40px**：它是句子的一部分，加 padding 撑到 40px
会把整段正文的行高撑开、出现空白断行（web-interface-guidelines �?inline links exempt）�?

#### 测试基建：模拟失败必须拦 XHR

「发送失败」那条断言如果只是**描述**失败时长什么样，它永远�?—�?
因为根本没有失败发生。必须真的让它失败�?
⚠️ **�?`XMLHttpRequest.prototype.open/send` 而不�?`window.fetch`** —�?
axios �?XHR，hook fetch 一条都拦不到（P30 段刚记过这个坑）�?
两个都挂上才不依赖「本项目用哪个」�?

⚠️ 拦截的恢复必须放�?`finally` 里、`s.close()` **之前**�?
留着它，这一轮崩了之后同一浏览器会话里的后续请求全拿到假响应，
而症状会指向别处 —�?�?P28 �?`finallyCleanup` 同源（清理不排空，受害的不是本组）�?

#### 环境导致�?flake（不是回归）

Vite 刚重启后第一�?`ui-smoke` 报「app 挂载超时」且只有 1/2 —�?
首次访问时依赖图还没编译完�?*预热访问一次首�?*即可，第二次�?42/42�?
判断依据是「只�?1~2 条断言 + 报错是挂载超时」，不是「smoke 组红了」�?

### P32 私信图片消息（本 commit�?

契约 **695** 条（674 + P32 �?21，其�?2 条是 P22 旧断言改码），CDP **647** 条（632 + 15）�?

P31 补齐了「像 IM」的气泡形态，P32 补上**能发�?* —�?这是 IM 的另一半，
缺了它「私信」仍然只是「文字留言板」�?

#### 三个设计决定，每一个都有代�?

**�?`content` �?`@NotBlank` 必须拿掉�?*
注解�?*无条�?*生效的，而图片消息的 `content` 恒为空串 —�?两者直接冲突�?
所以校验移�?service 里按 `type` 分支（`MessageServiceImpl.validate`）�?

⚠️ 代价：两�?P22 的旧断言（空消息、纯空格）从 `100001` 变成 `50008`�?
**改的是断言不是实现**，而且要把理由写进断言�?—�?否则下一个人看到「错误码变了�?
会去改代码而不是查为什么�?

⚠️ 两条规则必须**各自独立**判，不能写成「content 为空�?url 为空就报错」：
那样「有正文�?URL」会被放行，存进库之后渲染成一条空消息，而界面看不出异常�?

**�?只认站内图片 URL —�?本轮唯一的安全相关判断�?*
`normalizeImageUrl()` �?`URI` 解析�?host 再比�?*不能�?`contains`**�?
`https://evil.com/?x=/static/a.png` �?contains 实现下能过（契约里钉了这条）�?
理由�?*私信里的图是最不像链接、最容易骗过人的位置** —�?用户对「对方发来的图�?
的信任度远高于「对方发来的链接」，�?phishing 恰恰靠这个落差�?

**�?不做「图文混排」�?*
小红书发图就是纯图片，想带文字就再发一条。混着做的话，「会话列表的摘要�?
得在正文和图片之间二选一，而那两种选择都不是好产品行为�?

#### 三个「写成那样会静默出错」的地方

1. **`uploadImage()` 返回 `{ json, ... }`，URL �?`.json.data.url`�?*
   直接把返回值当 `imageUrl` 传下去会变成 `"[object Object]"`�?
   `normalizeImageUrl` 判为非法 �?50007（AGENTS P20 记过同一个坑）�?

2. **`/api/message/history` 的对�?id �?query（`withUserId=`）不是路径变量�?*
   写成 `/history/{id}` 拿到 100404，而下游是 `?? []` —�?于是
   「每条都�?type�?*恒真通过**、「有 type=2�?*恒假失败**，两头都不报错�?
   修法是加一条「历史真的取到了数据（防 URL 写错兜成空数组）」，
   这条**专门抓的就是「取不到就兜空数组」这类恒真断言**�?

3. **`type` 未知值（99）降级成 1 而不是报错�?*
   老客户端不传 `type`，而「type=2 却没�?URL」在下面单独判�?
   两者分开：挡「真参数错误」，放「老客户端不认识的取值」�?

#### 测试基建：两个我自己踩的�?

- **`loading="lazy"` 不能�?*。聊天页一屏只有十几条图，懒加载省不下什么，
  但它会让**刚好在视口底边那张图**�?`decode()` 一直不 resolve —�?
  表现是「最后一张图永远转圈」，与「懒加载 + 边界」隔了两�?
  （P25 在轮播上记过同一个坑，这里是另一个入口）�?

- **`decode()` 必须带超时兜�?*。对一张永远不进入视口的图
  （懒加载，或 src 指向 404），`decode()` **既不 resolve 也不 reject**�?
  �?`Runtime.evaluate` �?`awaitPromise` 会跟着一起挂�?—�?
  症状是「测试卡�?20 分钟」，与「那张图有问题」之间没有任何提示�?
  `Promise.race` 一�?`setTimeout` 才让这个失败点可控�?

- **注入测试用的 PNG 必须是完整可解码�?*。我第一版抄了契约测试里�?
  `TINY_PNG`，那个是**截断�?* —�?它只用来过服务端的内容类型白名单�?
  从不需要解码。于�?`<img>` 解码失败、`naturalWidth=0`�?
  症状是「图片没显示出来」，真因（字节不完整）隔了两层�?
  现在用手写的 1×1 红点（IHDR + IDAT(zlib) + IEND�?9 字节）�?

#### 一条跨轮的测试污染

P32 的图片消息让「对方最新一条」变成了图片行，�?P31 有一条断言�?
`row.querySelector('.bub').textContent` —�?**图片行没�?`.bub`**，于�?NPE 崩掉脚本�?
后面十几条用例一次都没跑，而输出只有一�?`27/28`�?

这与 P15 记的「`finally` 里的 `process.exit` 把异常变成通过」是同一个家族：
**断言脚本自己崩了，看起来像「测试跑完了，只是有几条没跑�?*�?
修法两处：查询改�?`.bub, .thumb`�?*锚点从「文本」改�?`data-msg-anchor` �?id** —�?
后者是因为多条图片消息的文本都�?`[图片]`，用文本做锚会永远命中第一条�?

#### P31/P32 待办

- **私信图片不做多图**：一次一张，要发多张发多条消息。所以没有「九宫格」分支�?
- **不做图片上传进度�?*：`uploadImage` 本身支持 `onProgress`，但 P32 没接 —�?
  聊天里传图通常 1~2MB，进度条收益小，而失败重发已经覆盖了「传不上去」这个场景�?
- **图片消息没有独立的已读回�?*：与文本消息一样走会话级已读�?
- **图片不做压缩**：本机压缩要引入 canvas + 质量参数调优�?
  而私信图是从手机相册直接选的原图，压缩后的画质损失比省下的那点流量更值钱�?
**P31/P32 已部�?*（prod 真调�?**32/32**：私信双向同会话、历史正序、图片消�?
`type=2` + 静态资源可�?+ 会话摘要 `[图片]`、`50007`/`50008` 校验分支�?
外链�?`javascript:` 拦截、关注≠拉黑、拉黑双向互禁、P24~P31 前端产物全部还在）�?
`sw.js` �?Content-Type �?JS（text/plain 会被浏览器拒绝注册）�?

⚠️ **这轮 8.2 墙③变了，而且绕法比原来简�?*�?

1. `sed` �?apt �?*已经不生�?* —�?新版 Ubuntu 基础镜像�?deb822 格式
   （`/etc/apt/sources.list.d/ubuntu.sources`），�?`sources.list` 根本不碰它，
   于是 `apt-get` 仍然去打官方源、仍�?502，报错说 `InRelease is not signed`
   —�?**报错说的是签名，实际�?502**�?
2. 正解�?*根本不装 curl**：`deploy/docker-compose.prod.yml` 里后端的
   healthcheck �?`curl` 改成 `wget`（前端那条本来就�?wget，顺手统一）�?
   curl 在这个基础镜像�?*不是自带�?*（`dpkg -S` 显示�?`apt-get install` 装的），
   �?wget 是基础镜像自带�?—�?少一个构建期网络依赖，比换源可靠得多�?

⚠️ **prod 探针的清理必须按「本轮造的东西」删，不能按「探针账号」删**�?
P32 那轮复用了常�?fixture（`xk_ui_admin` / `xk_ui_admin2`），库里根本没有
`prod32%` 这个账号，按前缀删等于什么都没删 —�?而脚本照常打�?
`left_msgs 5`�?*没有任何异常迹象**。最�?1 条更阴：拉黑用例里发的那条正文是 `x`�?
没有唯一标记，按任何前缀都删不掉�?*prod 是给人看界面�?*，别攒这种东西�?
### P34 竖屏沉浸流（�?commit�?

契约 **711** 条（695 + P34 �?16），CDP **674** 条（647 + 27，新�?`ui-immerse`）�?

**为什么跳过视频转�?*：量了三件事 —�?dev �?543 篇笔记、视频笔�?**0 �?*�?
`LocalVideoStorage` 早就写好但功能从未被人用过。给一�?0 条数据的功能做转�?
是投机。而沉浸流服务的是**全部图文笔记**，有真实用户与真实内容�?
⚠️ 若将来有了真实视频数据再单独立项 —�?转码 bug 恰恰出现在真实视频的
时长、GOP、分辨率变化上，�?1 帧的 mp4 验不出来�?

#### 三个设计决定

**�?排序与发现流刻意一�?*（后�?`immerseFeed` 复用**同一�?mapper 方法**）�?
两处排序若不一致，用户在首页看到的内容与滑到的内容会对不上，而「首页有但滑不到�?
极难归因。契约里有两条断言钉死「id 列表完全相同」与「total 相同」�?

**�?独立 VO 而不复用 `NoteListItemVO`**：那个只�?`cover` 一个封面，
而沉浸流要在**卡内轮播**全部图。复用它就得每划一屏多打一次详情请�?—�?
「一直往下划」的形态下，手感上就是「偶尔卡一下」�?
⚠️ 刻意**不带正文全文**：几百字会让每张卡高度不可控，破坏「一屏一张」的构图�?
只带 120 字的 `contentBrief`�?

**�?核心�?CSS `scroll-snap`，不是手势库**�?
�?手势库要自己算惯性、自己处理中断，边界处最容易出错�?
�?原生滚动天然支持键盘（↑�?/ PageUp/Down）与读屏，而这两样是自实现手势
最容易丢的（P14 那些可访问性整改的延续）�?
代价�?*没法做「快速连滑�?* —�?原生滚动会等动画结束才处理下一次，
而这不是一个值得付代价去换的能力�?

#### 两个「写得不对会静默出错」的地方

- **`<foreach>` 必须�?`<script>` 包裹**（AGENTS P18 记过同一个坑，我第二次踩）：
  第一次跑 8/21，接口返 `100999`，日志是
  `BindingException: Parameter 'id' not found. Available parameters are [param1, noteIds]`�?
  **报错说的是参数名，与「你忘了 script 标签」隔了一整屏**，而症状只是「系统繁忙」�?
- **图片必须一�?IN 批量�?*（`NoteImageMapper.listByNoteIds`），不能逐篇 `selectList`�?
  一�?6 条就�?6 次往�?vs 1 次。这个页面每次操作都触发翻页，省不掉�?

#### 测试基建：一条断言验证它有区分�?

�?`scroll-snap-type` 改成 `none` 重跑，那条「滚动容器用�?scroll-snap」立刻红�?
**PASS 也要看「它有没有可能恒真�?* —�?只断言「卡片能滚过去」的话，
没有 snap 也能过（手动�?`scrollTop = clientHeight` 当然对得上）�?
钉的必须�?*声明本身**（`getComputedStyle` 读到 `y mandatory`）�?

#### 顺带清掉的：全仓 16 处历史坏字符

扫全仓发�?HEAD 里有 **8 个文�?16 �?U+FFFD**，从 P26/P27/P28/P29 一路带下来�?
成因�?*�?PowerShell 写中文文�?*（GBK 解析 3 字节 UTF-8 时按 2 字节一组切�?
落成 2 个非法序�?—�?所�?*一处坏字符总是成对出现**，这是判据不是巧合）�?

已全部清掉，现在全仓 0 个�?*教训**：改 `.md` / `.mjs` / `.java` / `.vue` 一律用
Write/Edit 工具，不要用 PowerShell �?`Set-Content`、here-string 或字符串替换 —�?
它们会吃掉反引号、`${}`、`@` 与引号嵌套，且失败时**不报�?*�?
**P34 已部�?*（prod 真调�?**24/24**：沉浸流接口 + 与发现流排序一�?+ total 相同
+ size 夹取 + 未登录拒；`ImmerseView` chunk **与它�?CSS 都真的在产物�?*�?
P24~P32 前端产物全部还在）。prod 库本来就空（无表结构变更）�?

⚠️ **�?prod 的排序必须用「旁观者」账�?*：第一版用作�?A 查流，�?`pageDiscover`
�?`n.user_id != #{userId}`（发现流不回显自己发的笔记），于�?A 自己刚发的探针笔�?
根本不出现在结果�?—�?症状是「返回卡�?0 条」，而真因（排序排除自己）隔了一整屏�?
AGENTS 8.4 记过同一个坑，P23 那次也踩了�?

⚠️ **验「scroll-snap 真的生效」要�?CSS 文件里找，不能只�?JS chunk 里搜**�?
Vite 生产构建把组件样式抽成独�?.css，�?*CSS �?JS 的内容哈希不一定相�?* —�?
�?JS 的文件名去猜 .css �?404（`ImmerseView-3HW8Bfe6.js` 对应�?css �?
`ImmerseView-BCXT9QVe.css`）。正确做法是解析**入口 JS 里引用的 css 列表**
再取 ImmerseView 那个。这�?P24 段「抓 chunk 查特征串」是同一条方法的延伸�?
�?*样式必须�?CSS 产物，不能查 JS**�?
### P33 视频转码（本 commit�?

契约 **711** 条（不变），CDP **674** 条（不变）—�?本轮�?*纯后�?*改动�?
真调�?**13/13**（新脚本，不入库）�?

#### 为什么现在才�?

P19 做完「上�?+ 存原文件 + 播放器」时刻意**不转�?*，理由记在那里：
全库 `video_url` 全是 NULL，给一�?0 条数据的功能做转码是投机�?
现在做是因为存储层与前端播放器都已就位，缺它的代价是
**手机拍的 HEVC / 高码�?4K 在浏览器里播不出�?*�?

#### 先量后写：同步而非异步

| 样片 | 转码耗时 | 实时�?|
|---|---|---|
| 60s 1080x1920 �?720x1280 H.264（veryfast�?| 3.4s | 17.8x |
| 8s 1920x1080 �?1280x720 | 0.6s | 13.7x |
| 抽封面（�?1 秒） | 0.13s | �?|
| 压后体积 | 120MB �?10.57MB（压�?91%�?| |

**同步完全在上传请求的预算�?*，而异步要引入
「转码队�?+ 状态机 + 失败重试 + 前端轮询转码进度」—�?
一整套状态机的复杂度换一�?3.4 秒的等待，不划算�?
⚠️ 若将来视频长到几分钟或并发上来，这个结论要重新量（现在的 17.8x 是单�?24 核）�?

#### 三条降级原则

1. **ffmpeg 不存�?/ 转码失败 �?保留原文件并继续**，不让上传失败�?
   用户传的就是 mp4/webm，原文件多半本来就能播，转码�?
   「让它在更多设备上能播」的增强，不该成为「能不能发」的门禁�?
2. **已是目标规格就跳�?*（H.264 且短边≤720）——白�?3.4s 换一个几乎一样的文件�?
3. **封面抽失败不影响视频**：封面只是列表页与沉浸流的缩略图�?

#### 三个�?bug（每个都是「不报错但功能没生效」）

**�?`exec()` 只读�?stderr，stdout 没人读�?*
于是 `ffprobe` 的元数据全丢了，探针解析�?`0x0`，转码每次都�?
「取不到宽高」的降级分支�?*症状是「上传成功但文件没变小�?*�?
而小输出时管道缓冲装得下，进程既不阻塞也不超�?—�?**一路绿灯到今天**�?

**�?`substring(12)` �?`codec_name=h264` 得到 `264`**（`codec_name=` 只有 11 字符）�?
于是「是不是 h264」恒�?false�?*每个视频都白转一�?*�?
而症状只是日志里 `codec=264`（真�?`h264`），没有任何报错。现在一�?`split("=", 2)`�?

**�?转码输出 `<base>.mp4` 和输入是同一个文�?*，ffmpeg 截断自己的输入，
`exit=-22`、产�?0 字节。⚠�?**手工跑同一条命令是成功�?*（输出到别的目录），
所以对着参数列表看也看不出问�?—�?只有把输�?输出参数逐个对上才找得到�?
现在输出�?`<base>-t.mp4`，封面叫 `<base>.jpg`�?

#### 视频笔记的封面：为什么写�?`cover` 而不是新建字�?

P33 转码抽了封面，但**笔记�?`cover` 列仍然是 null** —�?�?`cover` �?
**首页瀑布�?/ 搜索 / 收藏�?* 唯一的图来源，于是视频笔记在所有列表里
都是一�?*空白�?*�?

修法是发布时把封面推导进 `cover`�?
`!images.isEmpty() ? images.get(0) : VideoTranscoder.coverUrlOf(videoUrl)`�?

**刻意不新�?`videoCover` 字段**：那些地方读的都�?`cover`，让它们各自
判断「type==2 就去算封面」要改十几个 VO 与前端分支；而封�?*本来就是
`cover` 这个字段该有的东�?* —�?P19 当时留空只是因为「还没想清楚视频�?
封面从哪来」，现在源头有了，字段就不用动�?

⚠️ 探针这边踩了三个连续的坑，都写进注释了：
�?�?*作�?*身份查发现流 —�?`n.user_id != #{userId}` 不回显自己发的；
�?只查**第一�?* —�?新发零互动的排在�?20 名之外（库里�?560+ 篇）�?
�?这两个合起来的症状都是「`cover=undefined`」，
而真因（没查到那条）与「cover 没被推导」隔了三层�?
**P33 已部�?*（prod 真调�?**13/13**：上传触发同步转�?�?URL �?`-t.mp4`�?
体积压到三分之一以下、封�?JPEG 可取、详情与发现流都�?cover�?
损坏视频�?500、P34 沉浸流与 P27 sw.js 产物都还在）。prod 库本来就空（无表结构变更）�?

⚠️ **prod 必须�?compose 里显式给 `XK_FFMPEG_PATH`**：`application.yml` 的默认值是
dev 用的 **Windows 绝对路径**（`E:\ffmpeg\bin\ffmpeg.exe`），容器里不存在该路径�?
不覆盖的后果极其隐蔽：上传照常成功、文件照常落盘、界面看不出任何异常�?
只是**每次都静默降级为「保留原文件�?* —�?�?prod 是给人看界面的，
没人会去看日志里那条 WARN�?

⚠️ **镜像里解 xz 会失�?*：`tar -xJf` 报的�?
`tar (child): Error is not recoverable: exiting now` —�?**报错完全不提 xz/lzma**�?
看起来像压缩包坏了，而真因是基础镜像�?GNU tar 没编�?lzma 支持�?
所以改�?*在主机上解压好再 COPY 两个二进�?*；代价是构建上下�?39.9MB �?152MB�?
但那只是本机一次构建，镜像层最终大小一样�?

⚠️ **探针�?`api()` 这层包装自己会出�?*：同一�?URL、同一�?token�?
�?`fetch` 能拿到数据而它返回 null（JSON.parse 抛了），我为此耗了三轮逐字比对�?
教训�?*先把产品行为验对，包装函数的 bug 单独记一�?* —�?
两者症状都是「列表里没有那条」，但只有后者值得继续挖�?
#### 环境（这台机�?

- ffmpeg **不随 jar 发布**：dev 装在 `E:\ffmpeg\bin`（不�?PATH，配置里写绝对路径）�?
  prod 后端镜像里要 COPY 一份静�?Linux 版�?
- ⚠️ **后端别用 `Start-Process` 挂在当前 shell �?*：它会随那个 shell 一起被回收�?
  表现为「转码跑到一�?8088 连不上」，而日志停得很正常、无任何异常 —�?
  我为此浪费了三轮重启才反应过来。正确做法是 `cmd /c start` 单开一个控制台进程�?

#### 已知取舍

- **不做多码�?*：只�?720p 一档。多码率要切片、存三份文件、加播放器选源逻辑�?
- **不做转码进度�?*�?.4 秒的等待里一个进度条是噪音�?
- **封面固定取第 1 �?*：手机拍的视频第 0 帧常是纯黑（还没对上焦）�?
- **不校验魔�?*：与 P19 一致，只按 content-type 白名单。转码失败会降级�?
  所以伪造文件名的后果是「存下一个播不了的文件」而不是安全洞�?

### P35 手测修复：私信接收方界面（本 commit�?

契约�?**711**（纯前端，零后端改动），CDP **681**�?74 + 7，ui-message 74�?1）�?

来自 2026-10-17 手测：用户从 `xk_ui_follow` �?`小哭猫` 的私信，收件方界�?
「头像加载不出来 / 多条消息挤在同一�?/ 界面完全混乱」�?
**四个真缺陷叠在一�?*，其中两个是「单向可见」——所以发送方一切正常�?

#### �?头像裂图：`:src="peerAvatar ?? ''"`

`<img v-if="!mine(r.msg)" :src="peerAvatar ?? ''">` —�?头像�?NULL �?*照样渲染
`<img src="">`**，浏览器把空串解析成**当前页面 URL** 去请求，拿到 HTML 当图片解码，
于是裂图 + alt 文字糊在气泡左边�?

⚠️ **不是边缘情况：dev 库里 12 个账号的 `avatar` 全是 NULL�?*
修法是三分支 `v-if`：自己这侧恒为占位、对方有头像才渲�?img�?
⚠️ 只写 `v-if="peerAvatar"` �?*引入�?bug** ——「自己这侧显示什么」和
「对方有没有头像」是两个独立问题，那样写会让自己的气泡旁边也显示对方头像�?
写法对齐 `ImmerseView` 的作者头像�?

#### �?消息挤在同一行：一�?P22 遗留的死 CSS

`MessageView.vue` �?scoped 样式里留着一�?P22 时代「聊天页头部显示对方资料卡�?
的规则：

```css
.peer { display: inline-flex; color: inherit; text-decoration: none; }
.peer .avatar { ... }   .peer .name { ... }
```

P31 重做 header �?*删了模板、没删样�?*。�?`.peer` 同时是消息行�?
`:class`（`mine(r.msg) ? 'me' : 'peer'`）——于是每�?*对方**消息�?
`<li class="row">` 都命�?`display: inline-flex`，`<li>` 从块级变成行内元素，
消息横向流式排布�?*自己这侧不带 peer 类，所以发送方看起来完全正常�?*

> **教训：重做布局时「删模板」与「删对应 CSS」必须当成同一件事做�?*
> 残留选择器不报错、不警告，只在它碰巧与别的选择器同名时静默改变布局�?

#### �?输入框被顶出视口 65px：`height: 100dvh` 没减 SiteNav

`.chat { height: 100dvh }`，而桌面端 `SiteNav` �?`position: sticky`
—�?*sticky 仍然占布局空间**，于是「顶�?67 + 聊天�?100vh」正好多�?67px�?
文档多出一条纵向滚动条，而输入框�?flex 列的末尾�?*底部落在视口之外**�?
症状是「聊天页底部看不见输入框」，真因在两屏之外的 `.chat` 高度上�?

修法：`@media (min-width: 1024px)` 里减�?`--xk-sitenav-h`
（`<1024px` �?SiteNav �?`display:none` 不占空间，所以不能无条件减）�?

⚠️ **三个坑叠在一起，每一个的症状都是「我改了却没反应�?*�?

1. **token 要算外高**：`.inner` 内容 50 + 上下 padding 16 = 66�?
   再加 `.site-nav` 自己�?`1px border-bottom` = **67**。先�?65 再写 66
   都不对，`docScrollable` 会是 1px�?
2. **`min-height` 必须一起压**：全局 `.page { min-height: 100% }` 会兜住，
   �?CSS �?**min-height 优先�?max-height**。只�?`max-height` 时实�?
   `max-height: 998px` 明明生效了、`height` 却还�?1063px�?
3. **单一来源**：token 定义�?`main.css` �?`:root`，`SiteNav` �?
   `min-height: var(--xk-sitenav-h)` 保证它不会漂。两处各写一个数就是这个�?
   （AGENTS 在详情页列宽 `--xk-col1` 上记过同一条）�?

#### �?缩略�?`cover` 把图裁没�?

160×160 的方框里 `object-fit: cover`�?61×367 的截图只剩中间一块，
430×900 的竖图只剩一�?—�?**收件人根本看不出对方发的是什�?*�?
而「看不清对方发了什么」在聊天里比「图不好看」严重。改�?`contain`�?
方框不变（网格不散）又能看全�?

#### 为什�?674 条断言一条都没抓�?

**这一节是本轮最值钱的部�?*，三条原因叠加：

1. **`ui-layout-audit.mjs` 根本没覆�?MessageView**（`PAGE_LIST` 里没有它），
   所以�? �?× 2 视口的几何体检」对它零覆盖�?
2. **头像断言只判「元素在不在 DOM�?*�?
   `s.check('对方气泡带头�?, av.hasImg)` —�?而旧实现**总是**渲染那个 `<img>`�?
   所�?`hasImg` 恒为 true、断言全绿�?*而图是裂�?*�?
   �?P30「浮层不能只�?querySelector」同家族，但更隐蔽一格：
   **存在 �?能加�?*，img 元素存在与解码成功是两件事�?
   现在�?`naturalWidth > 0`�?
3. **左右位置断言的判别力在「并排」时归零**：原来只�?`mineLeft > peerLeft`�?
   而消息挤在同一行时这个不等�?*依然成立**�?
   教训：位置断言只钉「相对关系」不够，还要钉�?*有没有另一条消息挡在前�?*」�?

#### 判别力验证（两轮都做了注入）

> AGENTS 反复强调「PASS 也要看它有没有可能恒真」。本轮两次把 bug 注入回去�?

| 注入 | 结果 |
|---|---|
| `.peer { display: inline-flex }` | 1 条红：`消息行是块级排版` |
| `v-if="!mine(r.msg)"` + `:src="peerAvatar ?? ''"` | 2 条红：`对方头像真的解码出来了`、`头像没有解码失败` |

⚠️ **`sameTop`（同 top 的行 >1）在注入 inline-flex 时没�?*，行数与气泡宽度组合�?
换行后的�?top 恰好各不相同。所以两条都留着：`sameTop` 钉「视觉结果」，
`display` 钉「机制」——只有机制那条能在巧合凑巧时仍然报警�?

#### 一条自己写歪、然后改掉的断言

「页面内没有任何解码失败的图片」最初写�?*全页 `<img>` 扫描**，第一次跑就抓�?
`/static/2026/10/x.png` —�?那是别的测试组删掉图片文件后�?*消息记录还在**的死链，
与本页正确性无关。这就是 AGENTS 说的「自造的用例不能假设库是干净的」：
断言一旦依赖全局数据状态，就会在某次全量连跑里假红，而真因隔了十万八千里�?
已收窄到只查头像�?

#### 顺带修掉的两条失效断言

- 「头像在气泡左边」原来取 `[data-test=message-avatar]`，修 �?之后对方无头像时
  它不存在 �?`dx=null` �?**恒红**。改�?img **�?* ghost 取其一�?
- 「头像尺�?�?2px」原来无条件 `imgW >= 32`，修 �?之后 `imgW` 恒为 0 �?恒红�?
  改为「有 img 才量」�?

> 两条都是**修测试的错误假设，不是迁就实�?* —�?理由已写进断言名与注释里，
> 否则下一个人看到「断言变了」会去改代码而不是查为什么�?

#### 环境

- `.chat` 的高度断言只在 **�?024px** 有意义；`<1024px` 没有 SiteNav�?
  `docScrollable` 天然�?0。断言放在桌面视口段里�?

### P35-b prod 日志：补�?`application-prod.yml`（本 commit�?

契约�?**711**、CDP �?**681**（纯后端配置，无测试改动）�?

**起因是一处文档与代码不一�?*：AGENTS �?7 �?P9 早就写着
「`backend/application-prod.yml`（prod profile）：SQL 打印与外发日志关掉�?
`xiaoku.jwt.secret=${XK_JWT_SECRET}` 无兜底、`init-demo-data` 默认 false」，
而这个文�?*在仓库里根本不存�?*。基础 `application.yml` �?
`log-impl: StdOutImpl` 硬编码着 —�?于是 prod 一直在打印全量 SQL�?

> **文档与实现不一致时先相信代�?*，本项目已经吃过好几次亏（P12/P23）�?
> 这次顺手把它补齐，让文档变成真的�?

#### ⚠️ 基础配置里有一�?*匹配不到任何�?*的「打�?SQL」设�?

```yaml
    # 打印 SQL
    com.xiaoku.module.mapper: debug     # application.yml L286
```

�?dev 日志里实际的 mapper logger 名（统计出来的）是：

```
com.xiaoku.module.note.mapper.NoteMapper
com.xiaoku.module.message.mapper.MessageMapper
com.xiaoku.module.user.mapper.UserMapper
com.xiaoku.module.feed.mapper.UserFollowMapper ...
```

**全部�?`com.xiaoku.module.<�?.mapper`，没有一个是 `com.xiaoku.module.mapper`**�?
所以这�?pattern 匹配不到任何 logger —�?是个**死配�?*�?
SQL 之所以被打印，是因为它们�?*父级 `com.xiaoku` 被设成了 `debug`**
（application.yml L284）。降�?`info` 就够了�?

> 这类「package 名写错但不报错」的设置特别坑：**它看起来在管某件事，
> 于是没人再去查真正的开关在�?*。发现办法很便宜 —�?
> 从日志里 grep 出实际的 logger 名（Spring �?`c.x.m.n.m.NoteMapper` 这种缩写�?
> 展开第一段就是包名），和配置里的 pattern 对一下�?

#### 验证方式（两次踩坑的记录�?

**第一�?*我把 prod profile 起在 8099，然后数日志里的 `Preparing:` 行，
得到 0 —�?判定「SQL 已关」�?*这个结论当时是错�?*，因为：

1. �?`> file` 重定�?stdout 看日志，**有缓�?*，进程被我强杀时缓冲区丢了�?
   只看到残缺输出；
2. 负载是「登�?5 次」，而登录是 **60/min/IP 限流**，AOP 在进 service 前就
   429 返回�?—�?**根本没打�?MySQL**，自然没�?SQL�?

**对照组按同样方式跑仍然是 0**，这才暴露上面两条。改成读 Spring 自己的日志文�?
（`XK_LOG_FILE`，有 flush）后仍为 0，最终确认是负载没产生查询�?

> 教训�?*「检查得�?0」必须先问「这检查有可能不是 0 吗�?*�?
> AGENTS 反复强调「PASS 也要看它有没有可能恒真」，这里又多一层：
> **对照组也要跑，且对照组必须真的走通了被测路径**，否则「修复前�?0�?
> 会让人误以为修复无效、或者反过来误以为修复有效�?

#### JWT 那条：无兜底 �?fail fast 已实�?

�?`XK_JWT_SECRET` 清空后用 prod profile 启动，应用在
`JwtUtil.init` 的长度校验处**拒绝启动**�?

```
Caused by: java.lang.IllegalStateException: xiaoku.jwt.secret 至少需�?32 字节（当�?16 字节�?
```

`JwtUtil` 自带两道闸（`!hasText` �?「未配置」；`< 32 字节` �?长度错误），
日志�?*没有**落回 `CHANGE_ME_...` 兜底值�?
compose 侧本来就�?`${XK_JWT_SECRET:?...}`，这里是第二道防�?
（覆盖「手�?`java -jar` 却没带环境变量」）�?

⚠️ 但本�?*没有�?prod 调用验过**（prod 日志里没做过一次带 SQL 负载的对照）�?
所以「SQL 确实不再打印」这一条的证据强度弱于其他几条�?
**已补�?prod 对照�?026-10-17 部署后）**：同 12 个请求（登录 6 + 话题列表 6�?
�?dev `Preparing` **+6**、打 prod **+0**，prod 日志 250 �?vs dev 2.5MB —�?判别力成立�?

### P35-c 重建 prod 后端镜像�?.2 三道�?+ 一个权限坑�?

契约 **711** / CDP **681** 都不变（纯部署）。为了让 `application-prod.yml` �?prod�?
后端镜像重建了一次�?

流程�?8.2 走，全部踩中并绕过：`mvnw -DskipTests package`（不�?`-o`）→
临时 Dockerfile 只复刻运行时阶段 �?`.dockerignore` 临时放行 jar�?*�?
`git checkout --` 还原，别�?`Set-Content -Encoding UTF8`，会�?BOM**）�?
⚠️ 这次**没踩 8.2 墙③**（apt）：因为临时 Dockerfile **根本不装 curl**�?
健康检查已�?P32 改成 `wget`（JRE 基础镜像自带）。少一个构建期网络依赖�?

#### ⚠️ `uploads` 是具名卷，而历史上曾有**�?root 运行的后�?*

症状极其不直观：上传视频返回 `20003 图片上传失败`�?*连「视频」两个字都没�?*�?
因为 `NOTE_UPLOAD_FAILED` 被图片和视频共用），日志里一�?
`AccessDeniedException: /app/uploads/2026/10/17/xxx.mp4`�?

根因链条�?

- compose �?`uploads:/app/uploads` �?*具名�?*，卷里已有的目录属主**不会**被新镜像�?
  `chown` 修正（卷只在新创建时才从镜像目录初始化内容与属主�?
- 卷里 `/app/uploads/2026/10/17` 的属主是 **uid 0**，而容器进程是 `USER app`（uid 1001�?
  �?对它只有 `r-x`�?*写不进去**
- 父目�?`/app/uploads/2026/10` 却是 1001:999 —�?说明**不是**「镜像忘�?chown」，
  而是历史上确实有**�?root 运行的后�?*（P33 那次的临�?Dockerfile 很可能没�?
  `USER app`）在那天建了这个目录

排查花掉几轮的是**「所有目录都不可写」的误判**：逐层 `touch` 时父目录能写�?
只有 `17` 那一层不行，于是先怀疑镜�?挂载 —�?真正该做的是
`find /app/uploads -user root` **先看有没�?root 属主的文�?*（有就说明有 root 进程写过）�?

修法：`docker exec -u root �?chown -R 1001:999 /app/uploads`�?
⚠️ **重建镜像不会顺手修好�?*（卷属主与镜像无关），所以每次重建后都该跑一次�?

#### 验证时踩的一个「检查写错了�?

第一版视频验收我造的�?**320×240** 样片，结果产�?*没有** `-t.mp4`�?
我据此判成「重建把 ffmpeg 弄坏了、静默降级」。实际是 **P33 降级原则②正确生�?*�?
已是 H.264 且短�?�?20 就该跳过�?*测试的样片必须超过目标档**（改 1920×1080
才测出真转码）�?

⚠️ 这与 AGENTS P26 那条「验证脚本的 PASS 也要看它有没有可能恒真」是同一类，
但方向相反：这次�?*FAIL 先到�?*，而真因是检查的输入选错�?—�?
**一个「红」同样要先问「它有没有可能是对的�?*�?

修好权限后重跑，prod 视频转码端到�?6/6：上�?code=0 �?产物 `-t.mp4` �?
封面 `.jpg`（`image/jpeg`，HTTP 200）→ 详情 `videoUrl` 一�?�?删除 0�?
探针笔记与文件按 8.4 / 8.8 清干净，prod 笔记数回�?0�?

### P35-d prod 登录页列�?*两个**测试账号（本 commit�?

契约 **711**（零后端改动），CDP **682**�?81 + 1，ui-smoke 42�?3）�?

23bc3bf 那轮�?prod 的演示账号入口换成了真实 fixture，但**只列了一�?*
（`xk_ui_admin`）。用户手测时提出「你得给我两个账号啊」——理由成立：
**私信要能看到「对方�?*，只有一个账号就没法自测收发两侧�?
�?P35 那轮的用户问题正是从**接收�?*视角发现的�?

改动只在 `LoginView.vue`�?

- `PROD_TEST` 从单个对象变�?*数组**（两�?fixture，口令同�?`Xk@2026peer`—�?
  AGENTS �?5 节本来就是同一个口令，少一个「记错哪个」的失败点）
- 界面�?*一行文字两个名�?*改成**逐账号一行、各自可�?*：点哪行填哪个账号�?
  一段并列的名字只能让人自己猜该点哪儿，而「点了会发生什么」必须看得见
- 元素�?clickable `<p>` 改成 `<button type="button">`�?
  点一下填表单�?*动作**不是导航（P21 的「导航归 a、动作归 button」）�?
  `<p>` 没有 role、没�?tab 序，读屏软件只派�?click 时键盘用户根本到不了
- 热区从约 20px 提到 **40px**（P13 下限），�?`aria-label` 与一个用途标�?

⚠️ **CDP 只能�?dev �?*：两套入口靠 `import.meta.env.DEV` 互斥�?
dev 服务器上 `v-else` 分支根本不渲染。所�?ui-smoke 新增的那条钉的是
**「dev 下不得出�?prod 账号提示�?*——防的是守卫写错（`v-if` 被改成只�?CSS 隐藏�?
导致 prod 用户看到一个点了必然失败的入口。prod 侧靠部署后核对�?

判别力验证：�?`v-else` 去掉�?`prod-hints` 无条件渲�?�?该条立刻红（42/43）�?
**PASS 也要看「它有没有可能恒真�?*�?

prod 真调�?8/8：列出两个账号、都�?`<button>`、热�?40px、有 aria-label�?
点第二行填的�?`xk_ui_admin2`（不是第一行）、dev 演示入口没混�?prod�?

### P35-e 私信头像：P35 只治了裂图，没治「看不见」（�?commit�?

契约�?**711**，CDP **681 �?682**（ui-message 74�?4，条目数不变�?*语义换了**）�?

用户看完 P35 的修复后问：�?*那为什么私信还是看不到两边的头�?*」�?
这句话点出了 P35 的问题：**它只修好了「不再裂图」，没修好「能看见头像�?*�?

#### 三层原因，第三层才是真问�?

| �?| 事实 |
|---|---|
| 表面 | P35 换成灰色空圆占位 —�?两边头像**依然没出�?*，只是不再破�?|
| 直接 | 两个账号（以�?dev 全部 **67 个账�?*）`avatar` 全是 NULL |
| **根因** | **全系统没有设置头像的接口** |

第三层是查出来的�?2 �?controller **无一**处理 avatar�?
`UserProfileUpdateDTO` 没有 `avatar` 字段，且**全后端没有任�?`setAvatar` 调用** —�?
`user.avatar` 这一�?*根本无法被写�?*�?

> 也就是说：整�?UI 到处都在渲染头像（私�?/ 首页 / 我的 / 作者页 / 通知 /
> 关注列表 / 沉浸流），却�?*一条路�?*能让它有值�?
> **这不�?UI bug，是一个缺的功�?*，需要产品口径决定（是否开放头像上传）�?

#### 真正的修法：跟着全站已有的约定走

写这份改动时才发现，**同一个功能的隔壁早就是这么写�?*�?

```
MessageListView.vue:88   :src="s.peerAvatar  ?? '/mascot/m02.webp'"   �?私信会话列表
NotificationView.vue:123 :src="n.actorAvatar ?? '/mascot/m02.webp'"
HomeView / ProfileView / UserView / FollowListView �?直接写死 m02
```

所�?P35 发明「三分支 v-if + 灰色空圆」是**既违背约定、又没解决问�?*�?

改成�?

- **两侧都显示头�?*，`avatarOf(m)` = 自己�?`userInfo.avatar`、对方是 `peerAvatar`�?
  都为空则 `|| '/mascot/m02.webp'`
- **自己这侧显示我的头像**，不是占�?—�?真实 IM（微�?QQ）就是这样�?
  ⚠️ P35 写「自己这侧恒为占位」的理由是「怕显示成对方的脸」，那个担心是对�?
  （`v-if` 只判 `peerAvatar` 确实会那样），但**解法错了**：应该取我的 avatar�?
  而不是两边都不显示。P35 差点真的犯这个错，是 review 时自己拦下的
- **�?`||` 而不�?`??`**：空串同样会让浏览器�?`src=""` 解析成当前页�?URL�?
  顺带的结构性好处：**根本没有空串这条路径**，`src=""` 不可能再发生
- 头部头像�?`?? ''` 一并去�?
- 删掉配套�?`.avatar-ghost` CSS —�?它已成死代码�?
  ⚠️ 这与 P35 的教�?*方向相反、同一个病**：P35 是「模板删�?CSS 没删」，
  这次是「改设计后忘删配�?CSS」。所以「改完回头看一眼这个选择器还有没有宿主�?
  是同一条纪律的两面

#### 一�?*恒真**的断言，删了而不是留着自欺

我本来加了「自己那侧不是对方的脸（断两�?src 不同）」。注�?bug 实测发现
**它抓不到任何东西**——因�?dev �?67 个账号全无头像，两侧都落到同一个吉祥物�?
界面行为与错误行�?*完全不可区分**。我第一版还加了 `|| src.includes('/mascot/')`
这个后门让它通过，�?*后门恰好覆盖了全部情�?*�?

> 删掉并把原因写进注释�?*要钉这条，前提是至少有一个账号有真实头像**�?
> 而这要等头像上传功能落地�?
> 现在能钉住的是「自己那侧不是空�?/ 不是裂图」那几条 —�?
> 改回 `v-if="peerAvatar"` 时双方都无头像会一�?img 都不渲染，立刻红�?

**判别力验�?*：注�?`avatarOf` 只返�?`peerAvatar`（P35 差点犯的错）�?**74/74 全绿**�?
如实记录「这条钉不住」，而不是宣称自己加了断言�?

#### 顺带修掉的两条被设计变更作废的断言

- 「头像在气泡左边」里 `img �?ghost` 的兼容查询已成死分支，清�?
- 「两侧占位宽度一致」随空圆占位一起作�?

prod 真调�?7/7：两侧都有头像元素、都解码成功（`naturalWidth>0`）、无�?src�?
无裂图、尺�?�?2px�?*两侧 `alt` 是不同昵�?*（证明取的是各自的数据源
而不是同一张）。已读截图人工核对，探针消息与会话按 8.4/8.8 清干净�?

#### 遗留（需产品决策�?

**要不要做头像上传**。不做的话全站永远是吉祥物兜�?—�?现在至少**统一且可�?*
（以前是三个页面写死吉祥物、ImmerseView 用灰圆、私信用裂图，三套并存）�?
要做的话改动面：`UserProfileUpdateDTO` 加字�?+ 复用现成�?
`ImageStorage`（图片上传已有限流与内容类型白名单）+ 前端「我的」页一个入口�?

### P36 头像上传 + 预设头像 + 默认昵称（本 commit�?

契约 **713**�?11 + 2），CDP **694**�?82 + 12，ui-profile 26�?9）�?

起因是用户一句：�?*给几个默认的头像啊，然后默认昵称，还有自定义头像和名�?*」—�?
P35-e 只是把「看不见头像」的兜底统一了，�?*用户依然永远没有头像**�?
因为全系统根本没有设置头像的接口（那里已查证）。这一轮补上整条链路�?

#### 为什么用「生成」而不是直接用现有�?11 张吉祥物

`/mascot/m01..m11.webp` �?*插画**（m02 实际 400×212 横图），头像要圆形裁�?
+ 只有 24~62px，裁完只剩猫的一小块。所以新画一�?*正方形、中间色调底 +
白色几何符号**�?8 张，24px 下轮廓仍然清楚�?

生成脚本 `frontend/scripts/gen-default-avatars.mjs` 沿用 `gen-pwa-icons.mjs`
�?*零依�?*套路（CDP 起浏览器 �?canvas �?�?dataURL �?Node 落盘），
不引�?node-canvas / sharp（那两个都要原生编译）�?
⚠️ 改配色或图形要改脚本后重跑，**不要手改 PNG** —�?手改出来的图不在白名单里�?

#### 头像字段�?*用户可写�?URL**，所以白名单是唯一的安全闸

`user.avatar` 透传的话，任何人都能设成 `javascript:` / `data:text/html` /
指向内网地址�?URL（列表页一次渲染几十个头像 = 借你的站点做内网探测）�?
`AvatarPresets` 只放行两种：**预设 8 �?*，或**本站上传前缀** `/static/uploads/`�?

> ⚠️ **实测抓到的真漏洞**：第一版只�?`startsWith(UPLOAD_PREFIX)`�?
> 于是 `/static/uploads/../../secret.png` 字面上以本站前缀开�?�?**放行（code=0�?*�?
> 我当时在 javadoc 里写「`startsWith` 挡不�?`..`，但那不是漏洞」—�?
> **那个判断是错�?*：存进库后浏览器会拿它去请求，服务端可能解析�?uploads 之外�?
> 现在额外显式拒绝 `..`、反斜杠、`//`、结�?`/`、`?`、`#`�?
> 验收脚本里五条攻击样本（外链 / javascript: / data: / 路径穿越 / 伪造扩展名�?
> 全部返回 10008�?

#### 预设名单做成接口，不让前端抄一�?

`GET /api/user/avatar-presets` 免鉴权（静态常量列表，不含用户数据）�?
前端硬编码一份的话，加图要改两处，漏一处就会出�?
「界面能选、提交被�?10008」或反过来「能提交但图 404」�?

⚠️ 第一次漏�?`MvcConfig.WHITE_LIST`，接口返 10005 —�?而我在注释里已经写了
「不要求登录」�?*注释写了不等于做�?*，这两件事要一起验�?

#### 默认昵称不能回退�?username

原来注册不传昵称就取 `username`。但 **P30 起用户名已退出界�?*
（只�?AdminView 保留），新用户若�?`ct_a1b2c3` 当昵称，
会在**每一个他人能看到的地�?*显示一串测试标识。改�?
「毛球喵社用�?+ id 末四位」。注册同时按 id 分配一个稳定默认头�?
（`AvatarPresets#defaultFor`）——「所有新用户都长一样」比「头像可空」更糟：
首页/关注�?私信列表会并排显示几十个同款默认脸�?

存量 67 个账号用一�?UPDATE �?id 回填（每�?7~10 人，分布均匀）�?

#### 前端：`UserAvatar` 组件 + 9 处替�?

**为什么要组件**：此前头像在 10 个视图里**四种写法并存** —�?三个页面把吉祥物
写死、`MessageListView` �?`?? '/mascot/m02.webp'`、`ImmerseView` 用灰色空圆�?
私信�?`?? ''`。直接后果是「没有头像」在不同页面表现完全不同�?
用户换了头像�?8 个页面不跟着变。组件把「取�?�?兜底 �?尺寸/形状」收成一处，
�?*永远渲染 `<img>`、不�?v-if/v-else**，于�?`src=""` 这条路径结构上不存在
（P35 的裂图就是这么来的）�?

顺带清掉两处配套�?CSS：`MessageView .avatar-ghost`、`ImmerseView .avatar.ghost`�?
⚠️ 这与 P35 的教�?*方向相反、同一个病**：P35 是「模板删�?CSS 没删」，
这次是「改设计后忘删配�?CSS」�?

#### 两个 UI 坑（都是先截图看出来、再量出来确认的�?

**�?头像块不能复�?`.field`�?*
`ProfileView` �?`.field` �?`display:grid` + `grid-template-columns: minmax(0,1fr) auto`
的两列栅格，还带一�?`.field > :not(.label):not(.count) { grid-column: 1/-1 }` —�?
那套契约是给「标�?+ 控件 + 字数」三件套设计的。头像块里有 **3 �?*并排元素�?
塞进去被自动排布挤到**重叠**：实�?`.avatar-pick` top=303、`.upload` top=315�?
上传钮直接压在第一行两个头像上面。改成自己的 `.av-field`（纵�?flex）�?

**�?选中态不能靠描边�?* 最初写 `border-color: 琥珀` + `inset` 内缩�?
选中**金色�?*那张（第 6 个）时琥珀环压在金色底�?*几乎看不出选中** —�?
选中色和头像底色撞了。改成「外侧留�?3px + 外侧琥珀�?2px」，
形状保证在任意底色上都可见（也满�?a11y 的「不只靠单一感官通道」）�?

#### 两条测试基建的自�?

**�?`[data-test=me-avatar-06.png]` 不是合法 CSS 选择器�?*
属性值里�?`.` �?`querySelector` **抛异�?*而不是返�?null —�?
AGENTS P25 �?`1:1` 那次记过同类坑（冒号），这次�?`.png` 里的点，
**必须�?`[data-test="me-avatar-06.png"]`**�?

**�?契约有两条断言钉的是旧行为，改的是断言不是实现**�?
「未�?nickname 时回落到 username」与「作者卡片带昵称 = ct2_xxx」�?
后者本意只是「卡�?*�?*昵称字段」，不该钉具体值；前者改成钉真正的不变量
（非�?+ 形如「毛球喵社用户NNNN�? 注册即有默认头像）�?
**理由都写进了断言上方的注�?*，否则下一个人看到「断言变了」会去改代码�?

#### 判别力验�?

把页头头像改回写死吉祥物 �?`页头头像跟着换成了新预设（不是吉祥物）` 立刻�?
�?8/39）�?*PASS 也要看「它有没有可能恒真�?* —�?这条要是只断言
「页面上有个头像元素」，在旧实现下会恒绿�?

后端验收 14/14（预�?8 �?/ 注册默认昵称+默认头像 / 换预�?/ 五条攻击样本全拒 /
被拒后头像没被改�?/ 清空�?null / 上传后可用）。CDP 全量 694/694，契�?713/713�?

#### 遗留

- **上传的头像不做压�?裁剪**：沿�?`ImageStorage` 原样存储�?
  一�?4MB 手机照片会原样存、原样下发给每个看得到该头像的人�?
  真要做要引入缩放（P25/P26 �?crop/filter �?*前端本机**处理�?
  头像这块要不要也走同一条路还没定）�?
- **头像变更不通知在线的其它会�?*：缓存已清（`evictUserVO`），
  但对方正在看的页面要等下次拉取才更新。可接受�?
- **不校验魔�?*：与 P19/P33 一致，`ImageStorage` 只按 content-type 白名单�?

### P36-b 预设头像换成**小哭�?*（本 commit�?

契约 **713**（未动），CDP **694**（未动）——纯素材重新生成 + 文档�?

**起因是用户否掉了 P36 的设�?*：我第一版画的是「中间色调底 + 白色几何符号�?
（圆�?圆点/菱形/方块/�?�?波纹/弧），理由是�?1 张吉祥物是插画�?
裁成方图认不出猫」。用户反馈：�?*小哭猫的头像怎么变成了五角星**」�?

**那个设计判断是错�?*，而且错在两处�?

1. **预设头像就该是小哭猫�?* 几何符号和「毛球喵�?/ 小哭猫」这个品牌毫无关系，
   预设头像的第一属性就是「这是站内角色的头像」�?
2. **两者并存会制造「同一个用户两个头像」的错觉**：小哭猫吉祥物在 SiteNav�?
   笔记封面兜底（`item.cover ?? '/mascot/m02.webp'`）等处到处都是，
   再加一套几何图形，同一屏里就出现两种完全不同的「猫」—�?
   用户正是因为这个才问「你这一个用户怎么还能有两个不同的头像」�?

#### 「两个头像」查过了：后端没有这种路�?

先把话说清楚，免得下一个人以为那里还有 bug。逐个接口查过（探测脚本）�?

| 接口 | 字段 | 结果 |
|---|---|---|
| `/api/feed/discover` · `/feed/immerse` · `/note/user/{id}` · `/note/collections` | `authorAvatar` | 全部有�?|
| `/api/search/note` | `authorAvatar` | 有�?|
| `/api/notification/list` | `actorAvatar` | 有�?|
| `/api/comment/list` | `avatar` | 有值（同一用户既是作者又是评论者时也一致） |
| `/api/message/session/list` | `peerAvatar` | 有�?|
| Redis | �?| `DBSIZE=0`，不是缓存陈�?|

库里每个用户只有一�?`avatar`（dev: 小哭�?`/avatars/06.png`、关注搭�?
`/avatars/01.png`），所有接口返回一致。所以那两个字面不同的「头像�?
是「预设几何图」与「到处出现的小哭猫吉祥物」的**观感冲突**，不是数据缺陷�?

⚠️ 顺带记一�?*本轮也确认了的既有问�?*（与头像无关）：作者主页上
`class="cover"` 的笔记封面有裂图 —�?那是别的测试组删掉图片文件后�?
**笔记记录还在**的死链（`/static/uploads/2026/10/18/*.png`）�?
�?AGENTS P35 记的 `/static/2026/10/x.png` 同一类，**不要**把头像断言
写成「页面内所�?img 都要解码成功」，那必然假红�?

#### 新生成方式：正方形底 + 吉祥�?contain 缩放�?*不裁�?*

11 张吉祥物的宽高比�?**0.81~1.99**（m02 �?400×212 横图），全都不是正方形�?
做法�?

- 256×256 正方形画布铺浅色底（头像容器自己切圆/圆角�?
- 吉祥物按 **contain** 缩放居中，四周留 8% 白边 �?猫占�?84%
- **刻意不裁�?*：裁 cover 会把猫的�?耳朵切掉�?4px 下更认不�?
- 8 张各配一只不同的�?+ 一个不同的浅底色（靠底色在小尺寸下区分�?

⚠️ 浅底色是必要的：深底 + 深色描边的小哭猫在暗色主题下会糊成一团�?

判别力验证：`ui-profile` 的「页头头像跟着换成了新预设（不是吉祥物）」那�?
仍然成立（它断的�?`/avatars/06.png` 这个**路径**，与图片内容无关），
所以换素材不需要改断言�?

已读截图人工核对�? 张全是小哭猫、选中态清晰、页头与选择器一致�?

### P37 长视频实测：抓到一�?nginx/后端三层不一致的�?bug（本 commit�?

契约 **713**（未动，纯配�?文案），CDP **698**�?94 + 4，ui-note 157�?61）�?

起因是用户说「我还没有视频，你去网上下一个来测试」——正好把 P33 结尾留的
那句「若将来视频长到几分钟或并发上来，这个结论要重新量」兑现掉�?

#### 实测数据（prod，真实下载的 Big Buck Bunny�?

| 文件 | 大小 | 时长 | 码率 | 端到�?| 结果 |
|---|---|---|---|---|---|
| BBB 10s 原片 | 29.3MiB | 10s | 24.6Mbps | 5.5s | �?真转�?|
| 循环 60s @8Mbps | 57.5MiB | 60s | 8.0Mbps | 14.4s | �?真转�?|
| 循环 180s @8Mbps | 172.2MiB | 180s | 8.0Mbps | **43.5s** | �?真转�?|
| 循环 210s @8Mbps | 200.9MiB | 210s | 8.1Mbps | 3.7s | �?`100003` 超限 |

**结论：同步转码在 200MB 上限内完全够�?*，实时率�?**4x**（含上传+转码），
离前端的 300s 超时差着一个数量级�?
⚠️ 所�?P33 结尾那句担心�?*多余�?*——真正的瓶颈不是超时，是 **200MB 体积上限**�?
手机 1080p 约每�?1MB，也就是 **上限约等�?3~4 分钟**�?

#### ⚠️ 但这次实测抓到的 bug 跟超时无关：nginx 只允�?100MB

172MB 那档第一次跑�?**0.5 秒就失败、code=undefined**。不是超时，是被立刻拒绝�?

查下来是三层上限不一致：

| �?| 上限 |
|---|---|
| 前端预检 `VIDEO_MAX` | 200MiB |
| 后端 `multipart.max-file-size` | 200MB |
| **nginx `client_max_body_size`** | **100m** �?异类 |

nginx.conf 里那行注释还写着「后端允�?20MB 单请求�?00MB 单次上传」—�?
那是 **P19 把后端提�?200MB 时忘了同�?*的�?

后果比「传不上去」更糟：nginx 返回的是 **HTML 错误页而不�?JSON**�?
`request.ts` 的响应拦截器拿不到业务码，用户看到的�?axios 原文
`Request failed with status code 413` —�?而「文件太大」只有用户自己知道�?

**两处修法**�?

1. `client_max_body_size 100m �?210m`（对齐后�?`max-request-size`�?
   多出来的�?multipart 边界余量�?
2. `request.ts` 的错误分�?*单独翻译 413 / 502 / 504**�?
   413→「文件太大，传不上去（换个短一点的视频或压缩后再试）」；
   502/504→「服务暂时不可用」（8.5 记过：重�?backend �?nginx 缓存�?
   upstream IP 就是这个症状，用户看到的却是网络错误�?

#### 顺带把「只�?200MB」的文案改成可操作的

`视频不能超过 200MB` �?`视频不能超过 200MB（约 3 分钟，手�?1080p 每秒�?1MB）�?
可以调低录制分辨�?帧率，或用系统自带剪辑压缩后再传`

理由：用户不知道自己录的算不算长。录�?5 分钟的人撞上「不能超�?200MB�?
一脸茫然，而告诉他「约 3 分钟」他能立刻判断该压缩还是分段�?

#### 测试基建：假 `files` 对象会污染后续流程（踩了才知�?

给体�?格式校验补断言时，�?`Object.defineProperty(input, 'files', {value:[fake]})`
避免了真�?200MB Blob（AGENTS 记过这台机内存只�?1.1GB）�?

⚠️ **但它污染了后面的用例**：处理函数里�?`input.value = ''` 清不掉这个自定义属�?
（那是自定义属性，不是原生 FileList），于是后续 CDP 设真文件**静默失效**�?
表现是「选完视频后显示文件名」「详情页播放器」连带假�?—�?
**症状在十几行之外，真因是这一�?defineProperty**�?
修法：假测试之后**重新加载页面**恢复干净输入�?

⚠️ 另外两条断言我自己写歪了，已删：
- 「被拦下后没有把文件收下」——原理上不可能成立（�?`files` 不会被清空）
- 「静态提示含『单个不超过 200MB』」——中文正则经 PowerShell 写出来变乱码
  （AGENTS 记过「不要用 PowerShell 写中文文件」），改成只�?`/200MB/`

判别力：注入前（文案还是「视频不能超�?200MB」）时，
`体积提示带「大约几分钟」的换算` 这条会红 —�?它测的就是文案本身�?

prod 验证：改�?nginx �?172MB �?413 变成 **43.5s 正常返回**�?
超限的那档返回干净的业务码 `100003`「上传文件超过大小限制」（不是 HTML）�?
CDP 全量 698/698�?

### P38 用户中心：编辑独立成�?+ 笔记/收藏/赞过�?Tab（本 commit�?

契约 **726** 条（713 + 13），CDP **710** 条（698 + 12，ui-profile 39�?1）�?

用户验收时明确要的三件事里做了两件：编辑资料独立成页、主页内�?Tab 化；
**「赞过」此前是缺的** —�?只有收藏夹（`GET /api/note/collections`，P15），
所以先补后端�?

#### 一、编辑资料独立成�?

`/profile/edit` �?`ProfileEditView.vue`。原���?`ProfileView` 里就地展开的表单，
有三个真问题�?

- **后退键不管用**：就地展开不是一次导航，浏览�?系统返回键直�?*退出整个页�?*
  而不是「收起表单」�?
- **桌面端会把右栏笔记区顶一�?*：表单在 `.side` 里展开，左栏变�?�?整个 grid 变高�?
- **保存/取消的语义不明确**：点「取消」到底是「放弃这次编辑」还是「回上一页」？

所以「编辑资料」从 `<button @click>` 改成 `<RouterLink to="/profile/edit">` —�?
去另一个页面是**导航**（P21：导航归 `a`、动作归 button）�?
`data-test` 一个没改名（`me-form` / `me-save` / `me-cancel` / `me-avatar-*` / `me-gender-*`），
所�?`ui-profile` 里绝大部分断言只是换了等待目标�?

⚠️ **搬走时必须连带清 import 与死 CSS**：留�?`ProfileView` 里的
`computed/onMounted/showSuccessToast/BizError/ErrorCode/getAvatarPresets/updateProfile/uploadImage/ProfilePatch`
既让 typecheck �?TS6133，更重要的是**它们暗示「这页还能编辑�?*�?
下一个人会照着找错地方�?

#### 二、Tab �?`<button role=tab>`�?*不改地址�?*

与首页「发�?关注」同款（P14 / P21）。小红书�?Tab 也不改地址栏，
所以这里没有「后退键切回上一�?Tab」—�?那是对的，不是缺口�?

三个数据�?+ **懒加�?*（切到才第一次拉，不�?onMounted 里把三个都拉一�?—�?
三个都拉会让主页首屏慢一倍，而用户多数只看第一个）�?*�?Tab 独立缓存**
（切回来不重拉；这三个列表都是「我自己的」数据，不存在被别人改掉的场景）�?

#### 三、`GET /api/note/liked` **不收 userId**

与收藏夹同源的理由：「我赞过什么」是私有数据，能�?id 就等于允许越权遍�?
别人的点赞历史。也不提供「TA 赞过的笔记」——小红书同样没有�?
`NoteLikeMapper.pageLikedNotes` 的形�?*照抄 `NoteCollectMapper.pageCollectedNotes`**�?
两个 Tab 的行为因此一致（都只显示 `status=1`）�?

`pageMyLikedNotes` �?`pageMyCollections` **刻意不抽公共泛型**�?
泛型化要引入 `Function` 参数�?authorIds/mine 传进去，对两个用例来�?
抽象成本高于收益；而一旦两者规则分叉（收藏夹可能加「已失效笔记」标记�?
赞过可能加时间分组），共用的那段反而成了要拆的负担�?

### P38 抓到的三个真问题 —�?全都是「绿得不干净」那一�?

这三�?*没有一条会让测试变�?*，所以它们能一路混到全绿才被我 review diff 抓到�?
AGENTS 反复说「PASS 也要看它有没有可能恒真」，这里是一次完整的实例�?

#### �?新路由漏 `meta.requiresAuth`�?*整份测试全绿也照样漏**

```
path: '/profile',
name: 'profile',
component: () => import('@/views/ProfileView.vue'),
-   meta: { title: '我的', requiresAuth: true },     �?被插入式改动顺手删掉
```
�?`/profile/edit` 时，新路由自己没�?`meta`，旧�?`/profile` 又被误删 —�?
于是**未登录也能进编辑�?*。页面本身不会崩（保存才 401），
但用户会看到一个填不满的表单�?

**为什么测不出�?*：`ui-profile` 全程已登录，守卫根本不会被触发�?
「未登录能不能进」这�?*必须单写一条反例断言**（P17 记过的同一形状�?
「插入式改动的最危险失败模式就是顺手删掉紧随其后的语句」）�?
已在�?1 节加�?`未登录访�?#/profile/edit 也被守卫拦下`�?

#### �?加载态的 `data-test` 写死 �?半个断言恒真

模板里写的是 `data-test="me-notes-loading"`（固定）�?
而测试等的是 `[data-test=me-liked-loading]` —�?*这个选择器永远选不�?*�?

```js
var l = document.querySelector('[data-test=me-liked-loading]')
return !!l || !!list || !!empty     // �?!!l �?false，这半个条件是死�?
```

整条「到达终态」当时是靠另两个分支撑着�?*偶然**是对的�?
已把模板改成 `:data-test="'me-' + tab + '-loading'"`�?
三个（loading/list/empty）都�?tab 变�?

#### �?⚠️ 修好 �?之后立刻暴露了它�?*两个错叠在一�?*

模板改对之后 `[data-test=me-liked-loading]` **真的存在�?*�?
于是 `waitFor` 里的 `!!l` �?*组件刚挂载那一刻就是真�?* —�?
「等加载完成」瞬间通过，紧接着的断言全在**转圈页面**上跑（当�?FAIL �?2 条）�?

> **两个错叠在一起时，一个修好会暴露另一个�?*
> 所以别把「现在是绿的」当「写对了」—�?当时那条断言**一�?*写着
> 「等终态」的注释，而它的条件恰恰是反面�?

正确条件是�?*没有**加载�?**�?*（列�?**�?* 空态）」�?

#### �?`token` / `orig` 必须�?`try` **外面**声明

fixture 还原搬进 `finally` 时，`const token` 还在 `try` �?�?`finally` 里引用抛
ReferenceError，�?*那个 catch 是空�?* �?异常被静默吞�?�?
「还原看起来跑了、实际一次都没生效」，`xiaoku_demo` 的昵称一次次被改坏，
**下一次运行第一条断言就假�?*（症状与真正的失败点隔了三十多行）�?

> **�?catch 吞掉异常比不写更�?*：它让「清理失败」和「清理成功」看起来一样�?
> 现在至少 `console.error` 出来�?

### P38 顺手收掉的仓库卫�?

- `.gitignore` �?`img/` / `logs-vite.txt` / `frontend/scripts/_*.mjs`�?
  `img/` 是截图目录（89 张、约 13MB，结论都已写进本文件），
  `_*.mjs` 是一次性探�?截图脚本 —�?**带下划线前缀是为了「一眼看出不是正式测试」，
  但光靠约定不�?*：P37 那个 `frontend/scripts/_verify-prod-av-video.mjs`
  就差点混进提交里�?
- ⚠️ **改行尾会制造「内容完全相同的 diff�?*：编�?`feed.ts` 时把
  `getMyCollections` 三行�?LF 写成�?CRLF，`git diff` 里出现三�?
  内容一模一样的 `-`/`+`，review 时会误以为我动了既有函数�?
  修法�?*�?HEAD 的原始字节重�?+ 纯追�?*（全�?`Buffer`，别�?
  「latin1 解码的旧字节」和「真正的中文字符串」拼成同一�?JS 字符串再�?
  latin1 写回 —�?CJK 码点会被截成低字节，注释全变乱码）�?

### P38 已知取舍

- **手机端主页是单列，首页瀑布流是两列**（桌面才 3 列）。小红书主页是两列瀑布�?
  这里没跟着�?—�?那是视觉改版，与本轮「补齐缺功能」混在一起会�?diff 难审�?
  留作下一轮�?
- **没有分页 UI**：三�?Tab 各取 `size=24` 一次�?
- **侧栏仍保留「我的收藏」链�?*，与「收藏」Tab 指向同一份数据（`/collections`
  是独立页，深链仍有用）。小红书主页只有一个入口，这里两个�?*有意保留**�?
  不是漏改�?
- **`loadTab` 失败也把 `loaded` �?true**：一次网络抖动后�?Tab 会一直空�?
  重进页面。取舍是「不反复重试一个失败的请求」，已写在代码注释里�?
- 背景头图 / 隐私设置 / 主页两列瀑布�?*不在本轮**�?

### P38 prod 部署与真调用

部署顺序�?.2 / 8.5 / 8.6 三条都适用）：
`mvnw -DskipTests package`�?*不带 `-o`**）→ 临时 Dockerfile 只复刻运行时阶段
�?*不装 curl**、静�?Linux �?ffmpeg/ffprobe 直接 `docker cp` 从旧容器取出�?
COPY 进去，因为本�?`tar -xJf` 解不�?xz）→ `.dockerignore` 临时放行 jar
�?build backend �?`--no-deps --force-recreate backend` �?`docker build frontend` �?
`--no-deps --force-recreate frontend`�?

⚠️ 这次**没踩 8.5 �?nginx 502**（后端容器重建后 IP 可能变，但这�?nginx
恰好还能连上）。判据照旧：`502` + `容器�?curl 正常` = 重启 nginx�?
prod 探针笔记数仍�?**0**（本轮只读不写，没有造任何数据）�?

prod 真调用：**接口 10/10**（`/api/note/liked` 返回 PageVO、未登录 `10005`�?
伪�?`userId` 不改变结果、size/page 夹取�? **界面 19/19**
（三 Tab / 编辑资料�?`<a href="#/profile/edit">` / 独立页有返回�?/
取消回主�?/ P35-d 两个 prod 账号、P36 头像选择器、P27 service worker 都还在）�?

#### ⚠️ P24 那条「抓 prod �?chunk 查特征串」在 P38 **失效�?*

P24 记的方法是「别比入�?chunk 的哈希，去抓 prod 实际提供的懒加载 chunk
再查特征串」。本轮照做，四条全红�?

```
FAIL  编辑�?chunk �?P38 的返回键 data-test   153
FAIL  ProfileView 里有 /profile/edit 链接       undefined
```

真因�?*Vite 把懒加载 chunk 拆成�?re-export stub**，`ProfileEditView-*.js`
只有 **153 字节**，真正的字符串在�?`import` 的下一�?chunk �?—�?�?
**JS chunk 的文件名不能用来猜它 import 的文件叫什�?*�?
P24 那条方法在「一�?chunk 打天下」时成立，代码一拆就恒假�?

> 改成在浏览器里真驱动界面（CDP）之�?19/19 全绿�?
> 而且**「未登录访问 `/profile/edit` 被守卫拦下」本来就只能这么�?*
> —�?静态查 chunk 无论如何都验不到路由守卫�?
> 判据�?*要验的是「用户看到的」，就去驱动界面；要验的是「产物存在」，去数文件�?*

#### 探针脚本自己踩的两个坑（都不是产品问题）

1. **`LoginVO` 的字段是 `accessToken` 不是 `token`�?* 写成 `token` 拿到
   `undefined`，然�?`Bearer undefined` 打到每个接口�?—�?但脚本第一句报的是
   「登录失败」，与「字段名写错了」隔了整整一行。AGENTS P29 记过同一形状�?
2. **改行尾时别把 CJK 码点截断**：`readFileSync(p,'latin1')` 之后拼上真正�?
   中文字符串再 `writeFileSync(p, s,'latin1')`，中文会变乱�?
   （码�?> 0xFF 被截成低字节）�?*全程 `Buffer` 才安�?*�?
   这条�?P22 记的「只�?node �?`spawnSync({input})` 能让字节原样送达」同源�?

### P46 举报处置闭环（本 commit�?

契约 **801** 条（791 + P46 �?10），CDP **795** 条（786 + `ui-admin` 9）�?

**用户反馈**�?关注搭子举报的评论被驳回了，为什么不发通知？驳回总得有理由吧�?

#### 两个真缺�?

| 缺口 | 现状 | 修法 |
|---|---|---|
| 举报人被处置结果失联 | 运营驳回/下架/删除/禁用后，举报�?*完全不知�?*结论 | 新增通知类型 8（`REPORT_DISPOSED`），四种 action 处置后都�?|
| 驳回不需要理�?| `handleNote` 可选，驳回可以留空 | service 层加必填校验（action=REJECT �?`handleNote` 空白 �?90008�?|

#### 后端三处改动

**�?`NotificationType` �?`REPORT_DISPOSED(8, "你的举报有处理结�?)`**
`targetId` = 举报�?id（uk 去重键），`noteId` = 被举报内容所在笔记（已删�?null，前端不渲染死链）�?

**�?`ErrorCodeEnum` �?`REPORT_HANDLE_NOTE_REQUIRED(90008)`**
必须放在 `REPORT_ALREADY_HANDLED(90003)` **之后**检查：对已处置举报再请求应�?90003，而不�?90008�?

**�?`AdminServiceImpl.handleReport` �?P46 逻辑**
- REJECT 理由空白 �?90008
- 提前计算 `reporterId` + `targetNoteId`（在删除/下架**之前**查，否则查不到）
- 处置成功后调 `notificationService.notifyReportDisposed(reporter, admin, reportId, noteId, outcomeText)`
- 文案格式：驳�?�?`你举报的内容经人工审核不构成违规，已驳回：{理由}`；其�?�?`你举报的内容{action.text()}，感谢你的监督`

`resolveTargetNoteId` 新私有方法：笔记举报返回 `targetId`；评论举报查 comment.getNoteId()（内容为 null 时返�?null）�?

#### 前端两处改动

**�?`AdminView.vue` 驳回走弹�?*
`doHandle` �?action=1 改走 `rejectModal`（自定义覆盖层，不是 Vant confirmDialog）：
- textarea 绑定理由，maxlength=200（与 DTO 一致）
- 提交按钮 `:disabled="!text.trim() || busy"`
- 点提�?�?`handleReport(id, 1, text)` �?成功后刷新列�?
- 弹窗模板�?`data-test=admin-reject-modal/input/submit/cancel`

**�?`NotificationView.vue` type=8 特殊渲染**
- 头像 + 昵称列显示�?*平台**」而不是管理员昵称（P18 原则：不暴露运营身份�?
- 点击时：�?noteId 跳笔记详情（已下架也�?reporter 可见）；�?noteId 只标已读不跳�?

#### 测试改动

**契约 P20 �?+4 �?*：驳回不带理�?�?90008；理由超 200 �?�?100001；下架后举报人收�?type=8 通知；P42 清理的两条驳回各产生一�?type=8 通知（targetId 不同 �?去重键正确）�?

**契约 P42 �?+4 �?*：两次驳回后 tA 的通知列表含两�?type=8（content 含「已驳回：P42 验收完成」）�?

**CDP `ui-admin` +9 �?*：驳回弹窗出�?+ 空提交禁�?+ 填理由后提交可用 + API 验证处置生效 + handleNote 写入 + adm2 收到 type=8 通知 + 通知含理由文�?+ 通知�?noteTitle�?

⚠️ **CDP 踩过的坑**：两份举报共享同一笔记标题时，`.find(e => e.textContent.includes(NOTE_TITLE))` 命中第一份（NORMAL），adm2 那份永远动不了。修法：用举报人昵称（`ADM2_NICK`）区分行；通知检查改�?API 直查（避�?CDP 导航到通知页超时）�?

#### 已知取舍

- **驳回必填，其�?action 不强�?*：下�?删除/禁用是平台主动处置，理由由运营自己决定；只有「不成立」需要解释为什么�?
- **type=8 通知�?actor 是管理员，但前端展示「平台�?*：不泄露运营身份（P18 原则的延伸）�?
- **内容已删时的 noteId = null**：点击只标已读，不跳死链�?
- **schema.sql 注释同步�?6/7/8**，存量库 comment 列无需 ALTER（cosmetic）�?

**P46/P47 �?dev 已验证；prod 部署记录见本轮之后的 docs 提交**（本次提交前
prod `18080` �?P45，P46/P47 �?prod 真调用按 8.2 / 8.5 / 8.6 的流程另跑）�?

### P47 搜索页「相关用户」区块（�?commit�?

契约 **801**（未动，纯前端），CDP **798**�?95 + `ui-message` 3，见下一节；
`ui-search` �?19 �?—�?**本轮没加断言**，见文末取舍）�?

用户手测：「搜索页只能搜到笔记，搜不到人」。�?P29 早就�?@ 候选做�?
`GET /api/search/user?keyword=&limit=`�?*只是结果页没�?* —�?又一处「接口有�?
界面没入口」的覆盖空洞，后端零改动�?*prod 真调�?`GET /api/search/user?keyword=xk` OK�?*

- `api/search.ts` 新增 `searchUsers(keyword, limit = 20)`，并�?
  `searchMentionUsers` **委托**给它（同一个接口、只差默认条数）�?
  不共用实现的话，两处路径/参数迟早漂移成「@ 候选能搜到、结果页搜不到」，
  而界面不会报错�?
- `SearchView.vue` 在笔记结�?*下面**并列一�?`[data-test=search-users]`�?
  `UserAvatar` + 昵称，点�?`#/user/{id}`。只取前 20 条�?*没有分页**
  （后端接口本来就是候选语义）�?
- 用户搜索**独立加载、独立报�?*：`searchUsers` 失败只让这一块显�?
  `[data-test=search-users-error]`（`role=alert`），**不影响笔记结�?*�?
  写成「一�?await 串起来」的话，用户接口抖动会让整页看起来像搜索坏了�?
- 关键词为空不发请�?—�?与笔记搜索同一道闸�?

⚠️ 这块**没有自己�?CDP 断言**（`ui-search` 19 条原样通过），这是本轮
明确的欠账：它验的是「接口能返回」，没验「结果页真的渲染出来」�?
下一轮动搜索页时应当补两条：`[data-test=search-user]` 数量 > 0�?
且点进去落在该用户主页�?*�?9/19 全绿」在这里不代表这个区块被覆盖过�?*

### 私信页移动端 TabBar 压住输入栏（�?commit�?

CDP **795 �?798**（`ui-message` 74 �?77）。纯前端，契约不变�?

用户截图反馈：私信页**底部输入栏被 TabBar 压住**，打字框最下面一条被切掉�?

#### 两级根因，缺一个都修不�?

**�?`.chat` 的移动端高度没减 TabBar，且 `min-height` 压过 `max-height`**

根元素是 `<main class="page chat">`（MessageView.vue L443），全局
`.page { min-height: 100% }`（main.css L274�? **整个视口�?*�?
`.chat` 虽然写了 `height/max-height: calc(100dvh - var(--xk-tabbar-h))`�?
�?**CSS �?`min-height` 优先�?`max-height`** —�?全局那条 `min-height: 100%`
把它兜回 900px，calc 那条 max-height 形同虚设�?

桌面 media 块（L698-702）本来就同时写了 `min-height`�?*移动块漏�?* —�?
P35 �?`.chat` 上踩过同一个坑（那次是桌面），这次是同一处代码的另一个分支�?
修法：移�?media 块补 `min-height: calc(100dvh - var(--xk-tabbar-h, 0px))`�?

**�?`--xk-tabbar-h` �?56px，�?TabBar 真实外高�?58px**

补完 �?后实测仍�?**2px**（`composer.bottom 844 / tabbar.top 842`）�?
�?TabBar 的盒子：`border-top 2px`（移动端 `--xk-stroke-w`�? `padding 4`
+ `tab min-height 48` + `padding 4` = **58**。也就是�?token 少算�?
**边框**�?2px —�?�?P35 记的「token 要用外高（`.inner` 50 + padding 16 +
border 1 = 67）」是**同一条教训的第二�?*�?

修法：`main.css` �?`html[data-tabbar='on'] .page { --xk-tabbar-h: 58px }`�?
这个 token 同时�?`.page` �?`padding-bottom`（L285）消费，所�?*全站移动�?
底部留白�?+2px** —�?那正是正确的行为（原来每页都少留 2px）�?

#### 验收�?30×900，真机尺寸）

```
--xk-tabbar-h = 58px        .chat  h=842 b=842
#message-composer b=842 h=75    .tab-bar t=842 b=900 h=58
overlap=false  gap=0
```

#### 回归断言（`ui-message` �?2b 段，+3 条）

�?`Emulation.setDeviceMetricsOverride` 显式切到 430×900（浏览器窗口尺寸
不等于视口，�?`--window-size` 量出来的值不可信），量三件事�?

1. `.chat` 高度 == 视口�?�?`--xk-tabbar-h`（钉 �?�?min-height�?
2. 输入栏底�?�?TabBar 顶边（钉「不遮挡」这个用户可见结果）
3. token 实测�?== TabBar �?`offsetHeight`（钉 �?的「token=真实外高」）

⚠️ **用完必须 `Emulation.clearDeviceMetricsOverride()`**，否则后面的
「加载更早的滚动补偿」断言会在 900px 视口里量，而它假设的是默认视口�?
这与 P31 的「补偿断言必须滚到中间才有判别力」是同一类：**改环境的断言
要自己收拾现�?*�?

判别力验证：�?token 改回 56px �?�?3 条红；去�?�?�?min-height �?
前两条红（`chat h=900`，输入栏落到 900）。两条都实测过�?

#### 顺带记一�?

`npm run build` �?`MessageView-*.css` 里能看到三行 height/max-height/min-height
同时�?`calc(100dvh - var(--xk-tabbar-h,0px))` —�?**三个都要�?*�?
只写 max-height 就是这次 bug 的形状�?

### P48 视频多码率 + 自绘播放器（本 commit�?

契约 **807** 条（801 + P48 �?6），CDP **803** 条（798：note 166�?9、immerse 24�?3、
message 74�?77 那三条属 TabBar 修复轮）�?**后端 + 前端都改了，一起验证**�?

#### 后端：多档位，失败必降级

- `VideoTranscoder` 两级变体：**主档 720p**（条件 `shortEdge > 720 || 非 h264`，
  否则跳过——已是目标规格就别白转一遍）+ **次档 480p**（原视频短边 < 480 只出主档）�?
  label 分别为 720p/480p；默认档 = 档位列表第一个，`url` 仍是它，**videoUrl 兼容不变**�?
- **降级是钉子不是兜底**：`ffprobe/ffmpeg` 失败 → 保留原文件。上传返回
  `{url, qualities}`，探测失败时 `qualities` **整个字段缺省**（non_null 序列化），
  不是空数组 —�?契约 +6 条断言里钉的就是这个形态：「降级时 qualities==null」�?
- `video_qualities VARCHAR(2048)` 存 JSON，publish/update **全量覆盖**�?
  ⚠️ **存量库要 ALTER**（表变更照旧不自动迁移，本轮 dev 已补列）�?
  ⚠️ 库缺列时症状极具迷惑性：**INSERT 不炸**（null 字段省略），**全列 SELECT 全炸** —
  笔记详情/评论/关注流集体 `100999`，还连锁到契约 `BigInt(undefined)` 崩溃�?
  先定位是 `Unknown column 'video_qualities' in 'field list'` 才恢复正常�?
- 封面照旧在发布时由 `VideoStorage.coverOf` 推导进 `cover` 列，本轮未动机制�?

#### 前端：VideoPlayer.vue 自绘播放器

- 原生 `<video controls>` 换成组件（原生 `controls=false`），两处接线：
  详情页 `note-video` 框、沉浸流卡片 `autoplay start-muted compact fill`（离屏停播）�?
  注意：全局没有音频焦点处理 —— 用户同时停在沉浸流和详情页两个视频上时，
  两支音频会并存（与抖音手机端行为一致），本轮接受。
- 清晰度切换**续播**：`pendingSeek/pendingPlay` 保留播放位置与播放态。
  `@ratio` 事件上报真实宽高比，两侧 `aspect-ratio` 因图片/视频分叉
  （`videoRatio` ref，视频无帧时回退 9/16）�?
- 无 qualities 时不渲染档位按钮 —�?降级路径在 UI 上是「按钮缺席」而不是「变灰」�?
  伪字节测试视频（假 ftyp 头）永远走降级分支，CDP 钉的就是「按钮不在」�?
- 埋点锚点 `vp-*`（`vp-play/vp-time/vp-track/vp-qualities/vp-mute/vp-full`），详情页共用前缀
  `note-video-player`�?ui-note 全部重写为断言这些（`controls=false`、track `role=slider`、
  `timeText` 回退 `0:00 / 0:00`、无档位按钮），不再数原生控件�?

#### 本轮环境三坑（都不是产品 bug，但每个都假红成片）

1. **dev MySQL 缺 `video_qualities` 列**（表变更不自动迁移的老规则又一次），
   契约在 ~101 条断言处 `BigInt(undefined)` 崩溃，真因是好几百条以外的
   全列 SELECT 先炸 → 定位到后端日志 `Unknown column 'video_qualities'`
   才能恢复（ALTER 一条解决，backend 不用重启）。
2. **`xiaoku_demo.is_private=1` 残留 + Redis `UserVO` 缓存**：直接 UPDATE 不走 `evictUserVO`，
   `/api/user/me` 持续返回旧值 → `me-nickname` 渲染出「私密」标签 → ui-smoke 假红�?
   FLUSH dev redis（各缓存都有 fail-open 重建路径，P8 记过）后才稳定。
3. **`xk_ui_follow → xiaoku_demo` 关注残留**：老版 P44 曾拿 demo 当私密作者，
   ui-follow 的「没人关注演示账号（demo 粉丝必须保持 0）」必红。删行即愈�?
   AGENTS P21 的教训原样重演：**多处同时假红先查全局状态**。

#### 已知取舍

- 视频仍不上 3 档之上的更多分辨率：部分码率收益递减，存储/带宽代价真实�?
- 搜索页「相关用户」区块本轮仍未补 CDP 断言（P47 的欠账原样保留）�?
- **prod 未部署本轮**：部署时照 8.2 / 8.5 / 8.6 流程，先给 prod 库 ALTER 列再起容器，
  并补「迁移不管自动」的验证记录。
