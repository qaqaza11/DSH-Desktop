# 拉取并组装 runtime/ (node.exe + dsh 包), 供 npm run dist 打包使用。
# runtime/ 不进 git, 新克隆的仓库在打包前必须先跑本脚本。
# 用法: powershell -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1
param(
  [string]$NodeVersion = '24.18.0',
  [string]$DshVersion = '0.1.0-rc.6'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

# 1) node.exe (win-x64)
$nodeExe = Join-Path $runtime 'node.exe'
if (-not (Test-Path $nodeExe)) {
  Write-Host "下载 node.exe v$NodeVersion ..."
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/win-x64/node.exe" -OutFile $nodeExe
} else {
  Write-Host "node.exe 已存在, 跳过下载"
}

# 2) @deepseek-ai/dsh (安装到 runtime, 不写 package.json)
$dshPkg = Join-Path $runtime 'node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path $dshPkg)) {
  Write-Host "安装 @deepseek-ai/dsh@$DshVersion ..."
  # --dangerously-allow-all-scripts 放开安装脚本(npm >= 11.3); 旧版 npm 无此策略可去掉该参数
  npm install --prefix $runtime "@deepseek-ai/dsh@$DshVersion" --no-save --no-package-lock --dangerously-allow-all-scripts
} else {
  Write-Host "@deepseek-ai/dsh 已存在, 跳过安装"
}

Write-Host "runtime 就绪:"
Get-ChildItem $runtime | Select-Object Name, Length
