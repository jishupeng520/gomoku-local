@echo off
cd /d "%~dp0"
if exist "runtime\\node.exe" (set "NODE_BIN=%~dp0runtime\\node.exe") else (where node >nul 2>nul && set "NODE_BIN=node")
if not defined NODE_BIN (
  echo 没有找到 Node.js。请使用带运行环境的分享包。
  pause
  exit /b 1
)
set OPEN_BROWSER=1
"%NODE_BIN%" server.js
pause
