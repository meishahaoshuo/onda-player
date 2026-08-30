@echo off
rem 双击启动音乐播放器（会保留一个最小化的命令行窗口作为服务器进程）
cd /d %~dp0
start "音乐播放器服务" /min node server.mjs
timeout /t 1 >nul
start "" "http://localhost:5181"
