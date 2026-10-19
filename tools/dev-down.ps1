<#
.SYNOPSIS
    停掉开发环境（后端 / 前端，可选连中间件）。

.DESCRIPTION
    ⚠️ **按端口杀进程，而不是按 PID 文件**。
    PID 文件记的是启动器（mvnw.cmd / npm.cmd 的 cmd 进程），
    而真正占着 8088 / 5180 的是它 fork 出来的孙进程 ——
    杀启动器只会让孙进程变孤儿继续占着端口，于是第二次 dev-up
    看到「端口已被监听」就跳过，然后你对着一个**旧进程**测了半天。

    默认**不动 prod**：18080 要用 -WithProd 才碰。

.EXAMPLE
    .\tools\dev-down.cmd
    .\tools\dev-down.cmd -WithContainers   # 连 dev 中间件一起停（容器保留，数据不丢）
    .\tools\dev-down.cmd -WithProd         # 连 prod 栈一起停
#>
[CmdletBinding()]
param(
    [switch]$WithContainers,
    [switch]$WithProd
)

$Root       = Split-Path -Parent $PSScriptRoot
$LogDir     = Join-Path $Root 'logs'
$BACKEND_PORT = 8088
$FRONTEND_PORT = 5180

function Step($m) { Write-Host ''
  Write-Host ("==> " + $m) -ForegroundColor Cyan }
function Ok  ($m) { Write-Host ("    [ok]   " + $m) -ForegroundColor Green }
function Skip($m) { Write-Host ("    [skip] " + $m) -ForegroundColor DarkGray }
function Info ($m) { Write-Host ("    [--]   " + $m) -ForegroundColor Gray }

function Get-PortPid {
    param([int]$Port)
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if ($c) { return $c.OwningProcess } else { return $null }
}

function Stop-ByPort {
    param([int]$Port, [string]$Label)
    $p = Get-PortPid $Port
    if (-not $p) { Skip "$Label (:$Port) 没在跑"; return }

    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
    $cmd  = if ($proc) { $proc.CommandLine } else { '' }

    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800

    if (Get-PortPid $Port) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
    }

    if (Get-PortPid $Port) {
        Write-Host ("    [FAIL] $Label (:$Port) 杀不掉 (PID $p)") -ForegroundColor Red
        Write-Host ('           ' + $cmd) -ForegroundColor DarkGray
        return
    }
    Ok ("$Label (:$Port) 已停 (PID $p)")
}

Write-Host ''
Write-Host '  毛球喵社 —— 停开发环境' -ForegroundColor White

# ---------------------------------------------------------------- 停应用
Step '停后端与前端（按端口杀，不信 PID 文件）'
Stop-ByPort $BACKEND_PORT  '后端'
Stop-ByPort $FRONTEND_PORT '前端'

# spring-boot:run 是 mvn fork 出子 JVM 的，杀掉监听进程后父 maven 常变成
# 没人管的孤儿、继续占着 CPU。这里按命令行特征把它一并收掉。
$orphans = Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'spring-boot:run' -and $_.CommandLine -notmatch 'plexus-classworlds' }
if ($orphans) {
    foreach ($o in $orphans) {
        Stop-Process -Id $o.ProcessId -Force -ErrorAction SilentlyContinue
        Ok ("孤儿 maven 进程已收 (PID " + $o.ProcessId + ")")
    }
} else {
    Skip '没有残留的 maven 父进程'
}

# ---------------------------------------------------------------- 停容器
Push-Location $Root
try {
    if ($WithContainers) {
        Step '停 dev 中间件（容器保留、数据不丢）'
        & docker compose -f docker-compose.yml stop redis mysql kafka elasticsearch 2>&1 |
            ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray }
        if ($LASTEXITCODE -eq 0) { Ok 'dev 中间件已停' } else { Write-Host '    [FAIL] 停止中间件失败' -ForegroundColor Red }
    } else {
        Skip '中间件保持运行（要停加 -WithContainers）'
    }

    if ($WithProd) {
        Step '停 prod 栈'
        if (Test-Path (Join-Path $Root 'deploy\.env.prod')) {
            & docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod stop 2>&1 |
                ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray }
            if ($LASTEXITCODE -eq 0) { Ok 'prod 已停' } else { Write-Host '    [FAIL] 停 prod 失败' -ForegroundColor Red }
        } else {
            Skip '没有 deploy\.env.prod，跳过 prod'
        }
    } else {
        Skip 'prod 保持运行（要停加 -WithProd）'
    }
} finally { Pop-Location }

# ---------------------------------------------------------------- 清理 pid 文件
if (Test-Path $LogDir) {
    Get-ChildItem $LogDir -Filter '*.pid' -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '  停了。恢复：.\tools\dev-up.cmd' -ForegroundColor Green
Write-Host ''
exit 0