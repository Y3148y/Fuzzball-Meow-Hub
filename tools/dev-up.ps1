<#
.SYNOPSIS
    重启电脑后一条命令恢复开发环境。

.DESCRIPTION
    六个阶段，按依赖顺序，每阶段都有明确的「成功判据」：

        0 引擎    docker version 探一次；不通就启动 Docker Desktop 并轮询到就绪
        1 中间件  compose up -d（四个并发启动，命令立即返回）
        2 关键依赖 --wait 等 mysql / redis 真正 healthy
        3 服务    后端与前端**同时**detached 启动（串行会白等 8 秒）
        4 就绪    并行轮询 8088 与 5180
        5 报告    表格：服务 / 端口 / 状态 / 耗时 + 日志路径

    ⚠️ 幂等：端口已在监听就跳过并标注「已在运行」，重复执行安全且第二次很快。

.PARAMETER WithProd
    额外拉起 prod 栈（18080）。默认**不带** —— 这台机 16GB，
    dev + prod 全开会只剩 2.9GB，AGENTS P21 记过内存不足导致的 flake。

.EXAMPLE
    .\tools\dev-up.cmd
    .\tools\dev-up.cmd -WithProd
    .\tools\dev-up.cmd -Tail
#>
[CmdletBinding()]
param(
    [switch]$WithProd,
    [switch]$Tail,
    [int]$EngineTimeoutSec = 240,
    [int]$DepsTimeoutSec = 240,
    [int]$AppTimeoutSec = 180
)

$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------- 路径与常量
$Root      = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $Root 'backend'
$FrontendDir = Join-Path $Root 'frontend'
$LogDir    = Join-Path $Root 'logs'
$EnvFile   = Join-Path $Root '.env'
$ProdCompose = Join-Path $Root 'deploy\docker-compose.prod.yml'
$ProdEnv  = Join-Path $Root 'deploy\.env.prod'
$DockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

$BACKEND_PORT = 8088
$FRONTEND_PORT = 5180
$PROD_PORT = 18080

$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ---------------------------------------------------------------- 输出helper
function Step  ($m) { Write-Host ''
  Write-Host ("==> " + $m) -ForegroundColor Cyan }
function Ok    ($m) { Write-Host ("    [ok]   " + $m) -ForegroundColor Green }
function Info  ($m) { Write-Host ("    [--]   " + $m) -ForegroundColor Gray }
function Skip  ($m) { Write-Host ("    [skip] " + $m) -ForegroundColor DarkGray }
function Warn  ($m) { Write-Host ("    [!!]   " + $m) -ForegroundColor Yellow }
function Fail  ($m) { Write-Host ("    [FAIL] " + $m) -ForegroundColor Red }

function Elapsed { param([double]$since)
    $d = $sw.Elapsed.TotalSeconds - $since
    if ($d -lt 10) { return ('{0:N1}s' -f $d) }
    return ('{0:N0}s'  -f $d)
}

# ---------------------------------------------------------------- 基础探针
function Test-Port {
    param([int]$Port)
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $c -and @($c).Count -gt 0)
}

function Get-PortPid {
    param([int]$Port)
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if ($c) { return $c.OwningProcess } else { return $null }
}

function Test-Http {
    param([string]$Url, [int]$TimeoutSec = 3)
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch {
        # 后端 ping 在启动中途可能返回非 200，也算「已经起来了」
        if ($_.Exception.Response) { return $true }
        return $false
    }
}

function Test-DockerEngine {
    $v = & docker version --format '{{.Server.Version}}' 2>$null
    return ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($v))
}

function Get-DotEnvValue {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path $Path)) { return $null }
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        if ($line -match ('^\s*' + [regex]::Escape($Key) + '\s*=\s*(.*?)\s*$')) {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Wait-Until {
    param([string]$Desc, [int]$TimeoutSec, [scriptblock]$Test)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (& $Test) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Get-ContainerHealth {
    param([string]$Name)
    $state = & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>$null
    if ($LASTEXITCODE -ne 0) { return 'missing' }
    return ($state | Select-Object -First 1)
}

# ⚠️ 日志可能含中文，一律按 UTF-8 读。用默认编码读会满屏乱码，
#    让人以为后端在打错误信息（AGENTS 22 节记过这个坑）。
function Show-Tail {
    param([string]$Path, [int]$Lines = 30)
    if (-not (Test-Path $Path)) { Write-Host '    (日志不存在)' -ForegroundColor DarkGray; return }
    Get-Content $Path -Tail $Lines -Encoding UTF8 |
        ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray }
}

function Url-Ok {
    param([string]$Url)
    if (Test-Http $Url 3) { return 'up' } else { return 'NO RESPONSE' }
}

function New-Row {
    param([string]$Name, [int]$Port, [string]$Status)
    $mark = '!'
    if ($Status -match 'healthy|^up$') { $mark = '+' }
    elseif ($Status -match 'starting') { $mark = '~' }
    return ($Name.PadRight(16) + ([string]$Port).PadRight(9) + $mark + ' ' + $Status)
}

Write-Host ''
Write-Host '  毛球喵社 —— 开发环境恢复' -ForegroundColor White
Write-Host ("  仓库: " + $Root) -ForegroundColor DarkGray

# ================================================================ 阶段 0：引擎
Step '阶段 0/5  Docker 引擎'
$t0 = $sw.Elapsed.TotalSeconds

if (Test-DockerEngine) {
    $ver = & docker version --format '{{.Server.Version}}' 2>$null | Select-Object -First 1
    Ok ("引擎已在运行 (Docker " + $ver + ")  +" + (Elapsed $t0))
} else {
    if (-not (Test-Path $DockerExe)) {
        Fail ("找不到 Docker Desktop: " + $DockerExe)
        Fail '请先安装/启动 Docker Desktop，再重跑本脚本。'
        exit 1
    }
    $running = @(Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue).Count -gt 0
    if (-not $running) {
        Info '引擎没起来，正在启动 Docker Desktop ...'
        Start-Process -FilePath $DockerExe | Out-Null
    } else {
        Info 'Docker Desktop 进程在，但引擎还没就绪，继续等 ...'
    }
    $ready = Wait-Until 'Docker 引擎' $EngineTimeoutSec { Test-DockerEngine }
    if (-not $ready) {
        Fail ("等了 $EngineTimeoutSec 秒引擎仍未就绪。")
        Fail '引擎没起来时任何 docker 命令都报 cannot connect to the docker API'
        Fail 'at npipe:////./pipe/dockerDesktopLinuxEngine —— 先手动开一次 Docker Desktop。'
        exit 1
    }
    $ver = & docker version --format '{{.Server.Version}}' 2>$null | Select-Object -First 1
    Ok ("引擎就绪 (Docker " + $ver + ")  +" + (Elapsed $t0))
}

# ================================================================ 前置检查
Step '前置检查'
if (-not (Test-Path $EnvFile)) {
    Fail ('缺少 ' + $EnvFile)
    Fail 'compose 用 ${MYSQL_ROOT_PASSWORD:?} 闸门，缺 .env 会直接 exit=1。'
    Fail '按 .env.example 复制一份即可（真实口令不提交，.gitignore 已覆盖）。'
    exit 1
}
Ok '.env 在'

if (-not (Test-Path (Join-Path $BackendDir 'mvnw.cmd'))) {
    Fail '找不到 backend\mvnw.cmd —— 仓库不完整？'
    exit 1
}

$mysqlPwd = Get-DotEnvValue $EnvFile 'MYSQL_ROOT_PASSWORD'
if ([string]::IsNullOrWhiteSpace($mysqlPwd)) {
    Fail '.env 里没有 MYSQL_ROOT_PASSWORD'
    Fail '少设 XK_MYSQL_PASSWORD 时后端起不来，报的是 Access denied for user root@172.20.0.1'
    Fail '—— 与「少了环境变量」隔了十万八千里，别去查口令本身。'
    exit 1
}
Ok '.env 里有 MYSQL_ROOT_PASSWORD'

$javaHome = 'E:\JDK17\jdk-17.0.1'
if (-not (Test-Path (Join-Path $javaHome 'bin\java.exe'))) {
    Warn ("找不到 " + $javaHome + "，将用 PATH 上的 java —— JDK8 会报「无效的目标发行版: 17」")
}

if ($WithProd -and -not (Test-Path $ProdEnv)) {
    Fail ('缺少 ' + $ProdEnv)
    Fail 'prod 的 .env.prod 不入库（gitignore），需从 .env.prod.example 复制并填值。'
    exit 1
}

# ================================================================ 阶段 1：中间件
Step '阶段 1/5  dev 中间件（redis / mysql / kafka / elasticsearch）'
$t1 = $sw.Elapsed.TotalSeconds
Push-Location $Root
try {
    & docker compose -f docker-compose.yml up -d redis mysql kafka elasticsearch 2>&1 |
        ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) { Fail 'compose up 失败（上面是原始输出）'; Pop-Location; exit 1 }
} finally { Pop-Location }
Ok ('已下发启动命令（四个并发）  +' + (Elapsed $t1))

# ================================================================ 阶段 2：关键依赖
Step '阶段 2/5  等 mysql / redis 真正 healthy'
$t2 = $sw.Elapsed.TotalSeconds
Push-Location $Root
try {
    & docker compose -f docker-compose.yml up -d --wait --wait-timeout $DepsTimeoutSec mysql redis 2>&1 |
        ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray }
    $depsOk = ($LASTEXITCODE -eq 0)
} finally { Pop-Location }

if ($depsOk) {
    Ok ('mysql / redis healthy  +' + (Elapsed $t2))
} else {
    Fail ("等 healthy 失败/超时（${DepsTimeoutSec}s）。下面是现在的状态：")
    foreach ($c in @('xiaoku-mysql', 'xiaoku-redis', 'xiaoku-kafka', 'xiaoku-elasticsearch')) {
        Write-Host ('    ' + $c.PadRight(24) + (Get-ContainerHealth $c)) -ForegroundColor DarkGray
    }
    Fail '后端强依赖 mysql + redis：redis 缺了报错藏在 Process terminated with exit code: 1 后面，'
    Fail '真因在日志上方几百行的 Connection refused: 127.0.0.1:6379。'
    exit 1
}

# ================================================================ 阶段 3：起服务
Step '阶段 3/5  启动后端与前端（并行，不串行等）'
$t3 = $sw.Elapsed.TotalSeconds

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# ---- 后端
if (Test-Port $BACKEND_PORT) {
    $pid8088 = Get-PortPid $BACKEND_PORT
    Skip ("$BACKEND_PORT 已在监听 (PID $pid8088)，跳过启动")
    $backendStarted = $false
} else {
    $env:JAVA_HOME = $javaHome
    $env:Path = "$javaHome\bin;$env:Path"
    # AGENTS 3：口令变量是强制的，少设不会报「未解析的占位符」，只会报 Access denied
    $env:XK_MYSQL_PASSWORD = $mysqlPwd
    $p = Start-Process -FilePath (Join-Path $BackendDir 'mvnw.cmd') `
        -ArgumentList '-o', '-q', 'spring-boot:run' `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput (Join-Path $LogDir 'dev-backend.out.log') `
        -RedirectStandardError  (Join-Path $LogDir 'dev-backend.err.log') `
        -WindowStyle Hidden -PassThru
    Set-Content -Path (Join-Path $LogDir 'dev-backend.pid') -Value $p.Id -Encoding ASCII
    Ok ("后端已拉起 (mvnw PID " + $p.Id + ") → logs\dev-backend.out.log")
    $backendStarted = $true
}

# ---- 前端
if (Test-Port $FRONTEND_PORT) {
    $pid5180 = Get-PortPid $FRONTEND_PORT
    Skip ("$FRONTEND_PORT 已在监听 (PID $pid5180)，跳过启动")
} else {
    $p = Start-Process -FilePath 'npm.cmd' `
        -ArgumentList 'run', 'dev' `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput (Join-Path $LogDir 'dev-frontend.out.log') `
        -RedirectStandardError  (Join-Path $LogDir 'dev-frontend.err.log') `
        -WindowStyle Hidden -PassThru
    Set-Content -Path (Join-Path $LogDir 'dev-frontend.pid') -Value $p.Id -Encoding ASCII
    Ok ("前端已拉起 (npm PID " + $p.Id + ") → logs\dev-frontend.out.log")
}
Ok ('进程下发完毕  +' + (Elapsed $t3))

# ================================================================ 阶段 4：等就绪
Step '阶段 4/5  等两个服务真正可用'
$t4 = $sw.Elapsed.TotalSeconds

if ($backendStarted) {
    $bOk = Wait-Until '后端' $AppTimeoutSec {
        Test-Http ("http://127.0.0.1:$BACKEND_PORT/api/system/ping")
    }
    if ($bOk) { Ok ("后端就绪 :$BACKEND_PORT  +" + (Elapsed $t4)) }
    else {
        Fail ("后端 $AppTimeoutSec 秒内没就绪。最后 30 行日志：")
        Show-Tail (Join-Path $LogDir 'dev-backend.out.log') 30
        Show-Tail (Join-Path $LogDir 'dev-backend.err.log') 10
        Fail '常见真因（按 AGENTS 的顺序查，别乱翻代码）：'
        Fail '  1) docker ps 看 redis 在不在 —— 少了就是 Connection refused: 127.0.0.1:6379'
        Fail '  2) echo $env:XK_MYSQL_PASSWORD —— 空值也会起不来，报 Access denied'
        exit 1
    }
} else {
    Skip '后端已在运行，不重复等待'
}

if (Test-Port $FRONTEND_PORT) {
    Skip ("前端已在运行 :$FRONTEND_PORT")
} else {
    $fOk = Wait-Until '前端' $AppTimeoutSec {
        Test-Http ("http://127.0.0.1:$FRONTEND_PORT/") 2
    }
    if ($fOk) { Ok ("前端就绪 :$FRONTEND_PORT  +" + (Elapsed $t4)) }
    else {
        Fail ("前端 $AppTimeoutSec 秒内没就绪。最后 30 行日志：")
        Show-Tail (Join-Path $LogDir 'dev-frontend.out.log') 30
        Fail 'vite 配了 strictPort:true —— 端口被占会直接报错而不是自动换端口'
        exit 1
    }
}

# ================================================================ 阶段 5：报告
Step '阶段 5/5  就绪报告'

$rows = @()
$rows += (New-Row 'MySQL'        3309  (Get-ContainerHealth 'xiaoku-mysql'))
$rows += (New-Row 'Redis'        6379  (Get-ContainerHealth 'xiaoku-redis'))
$rows += (New-Row 'Kafka'        9092  (Get-ContainerHealth 'xiaoku-kafka'))
$rows += (New-Row 'Elasticsearch' 9250 (Get-ContainerHealth 'xiaoku-elasticsearch'))
$rows += (New-Row '后端'         $BACKEND_PORT  (Url-Ok ("http://127.0.0.1:$BACKEND_PORT/api/system/ping")))
$rows += (New-Row '前端'         $FRONTEND_PORT (Url-Ok ("http://127.0.0.1:$FRONTEND_PORT/")))

$total = ('{0:N1}s' -f $sw.Elapsed.TotalSeconds)
Write-Host ''
Write-Host ('    ' + '服务'.PadRight(16) + '端口'.PadRight(9) + '状态') -ForegroundColor White
Write-Host ('    ' + ('-' * 40)) -ForegroundColor DarkGray
foreach ($r in $rows) {
    Write-Host ('    ' + $r) -ForegroundColor White
}
Write-Host ('    ' + ('-' * 40)) -ForegroundColor DarkGray
Write-Host ('    总耗时 ' + $total) -ForegroundColor White

# ---- prod（按需）
if ($WithProd) {
    Step '额外：prod 栈（18080）'
    Push-Location $Root
    try {
        & docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod `
            up -d --wait --wait-timeout 300 2>&1 |
            ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray }
        $prodOk = ($LASTEXITCODE -eq 0)
    } finally { Pop-Location }
    if ($prodOk) {
        Ok ("prod 就绪 :$PROD_PORT  +" + (Elapsed $t4))
    } else {
        Warn 'prod 没在超时内全部 healthy —— 它是可选项，不影响上面 dev 已经可用'
    }
}

Write-Host ''
Write-Host '  可以干活了：' -ForegroundColor Green
Write-Host ("    前端 http://127.0.0.1:$FRONTEND_PORT") -ForegroundColor White
Write-Host ("    后端 http://127.0.0.1:$BACKEND_PORT") -ForegroundColor White
Write-Host ("    日志 Get-Content logs\dev-backend.out.log -Tail 50 -Wait") -ForegroundColor DarkGray
Write-Host ("    停服 .\tools\dev-down.cmd") -ForegroundColor DarkGray
Write-Host ''

if ($Tail) {
    Write-Host '  --Tail：正在跟踪后端日志，Ctrl+C 退出' -ForegroundColor Yellow
    Get-Content (Join-Path $LogDir 'dev-backend.out.log') -Tail 40 -Wait
}

exit 0