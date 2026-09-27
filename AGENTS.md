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
# 后端（需后端已在 8088 运行）→ 44 条
cd backend && node scripts/contract-test.mjs
# 换地址：XK_API_BASE=http://ip:8088 node scripts/contract-test.mjs

# 前端（需前端 5180 + 后端 8088 同时在跑）→ 18 + 8 = 26 条
cd frontend && npm run test:ui
```

契约测试每次跑会新建 `ct_<时间戳>` / `ct2_<时间戳>` 两个账号（必须随机，
固定账号会撞 `10003` 就测不到注册成功分支）。清理时**必须用 `REGEXP`
而不是 `LIKE`** —— MySQL 里 `LIKE 'ct_%'` 的 `_` 是单字符通配符，会误删：

```sql
DELETE FROM xiaoku_db.user WHERE username REGEXP '^ct2?_[a-z0-9]+$';
```

前端 CDP 测试用固定账号 `xk_ui_smoke`（常驻一条 fixture，撞 `10003` 判为通过），
不要清理它。测试需要 Chrome，路径可用 `XK_CHROME` 覆盖。

---

## 6. 已完成状态（2026-09-27）

- P0 环境编排 / P1 统一响应与异常 / P2 用户模块 + JWT / P4 部分（登录 + 首页）已合并推送
- 品牌改名已落地（`62ed4c5`），测试通过且未改任何测试断言
- 契约测试已落盘（`f8f412c`）
- 口令兜底修正 + 注释订正（`cf93b22`）
- **下一步：P3 笔记发布 + 图片上传**
  （`20xxx` 笔记域错误码已在 `ErrorCodeEnum.java:39` 预留：
  `NOTE_NOT_FOUND` / `NOTE_STATUS_ILLEGAL` / `NOTE_UPLOAD_FAILED` / `NOTE_IMAGE_LIMIT_EXCEED`；
  `schema.sql` 里还没建笔记表）
