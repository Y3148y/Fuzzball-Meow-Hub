@echo off
REM Stop dev environment (backend / frontend, optionally containers + prod).
REM ASCII-only on purpose: cmd.exe reads .cmd in the OEM codepage, so CJK
REM comments turn into mojibake (and can even break quoting) on some code pages.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-down.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%