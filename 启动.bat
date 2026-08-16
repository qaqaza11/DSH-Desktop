@echo off
rem DSH Desktop 一键启动脚本
rem 注意: 不能用 %~dp0 直接带尾反斜杠传参(会解析成转义引号), 用 %~dp0. 形式
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
