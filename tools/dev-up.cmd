@echo off
REM 双击即可。参数原样透传给 dev-up.ps1（-WithProd / -Tail 等）。
REM ⚠️ 本文件刻意**只含 ASCII**：cmd.exe 按 OEM 代码页读 .cmd，
REM    中文注释在某些代码页下会变成乱码甚至被截断（AGENTS 记过这个坑）。
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-up.ps1" %*
set RC=%ERRORLEVEL%
echo.
if not "%RC%"=="0" echo [dev-up] failed with exit code %RC%  -- see the message above
pause
exit /b %RC%