@ECHO off
rem 随 DSH Desktop 分发的 dsh 启动器 — 使用同目录自带 node.exe 与 dsh 包, 零外部依赖
SETLOCAL
SET "dp0=%~dp0"
IF EXIST "%dp0%node.exe" (
  SET "_prog=%dp0%node.exe"
) ELSE (
  SET "_prog=node"
)
"%_prog%" "%dp0%node_modules\@deepseek-ai\dsh\lib\bin.js" %*
