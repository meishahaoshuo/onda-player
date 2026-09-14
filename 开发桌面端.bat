@echo off
chcp 65001 >nul
title Onda Player - 桌面端开发模式
cd /d "%~dp0"

echo.
echo === Onda Player 桌面端开发模式 ===
echo     前端改动保存即生效，不需要打包
echo.

rem ---- 1. 确保 Vite 开发服务器（5180）在跑 ----
netstat -ano | findstr ":5180" | findstr "LISTENING" >nul
if not errorlevel 1 goto vite_ready

echo [1/3] 开发服务器未运行，正在启动 Vite...
start "Onda Vite Dev Server" cmd /c "npm run dev"
set /a tries=0
:vite_wait
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":5180" | findstr "LISTENING" >nul
if not errorlevel 1 goto vite_ready
set /a tries+=1
if %tries% lss 45 goto vite_wait
echo       等待超时（45 秒），仍继续启动桌面窗口
goto vite_ready

:vite_ready
echo [1/3] 开发服务器就绪: http://localhost:5180

rem ---- 2. 单实例锁检查（已安装版与开发实例共用同一 identifier）----
tasklist /FI "IMAGENAME eq app.exe" 2>nul | findstr /I "app.exe" >nul
if not errorlevel 1 (
  echo.
  echo       注意: 检测到 app.exe 正在运行。
  echo       已安装的 Onda Player 与开发实例共用单实例锁，
  echo       若它是已安装版，本次开发窗口会启动后立刻退出。
  echo       请先退出已安装的播放器，再重新双击本脚本。
  echo.
  pause
  exit /b
)
echo [2/3] 无实例冲突

rem ---- 3. 启动桌面窗口 ----
echo [3/3] 启动桌面窗口（首次启动或改动过 Rust 代码需等编译）
echo.
echo       Ctrl+C 或关闭本窗口 = 结束开发模式
echo.
npm run desktop
echo.
echo 桌面窗口已退出。
pause
