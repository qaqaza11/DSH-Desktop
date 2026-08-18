# 拉取并组装 runtime/ (node.exe + dsh 包), 供 npm run dist 打包使用。
# runtime/ 不进 git, 新克隆的仓库在打包前必须先跑本脚本。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1              # 按兼容矩阵取默认版本, 已就绪则跳过
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1 -Force       # 强制重新下载/重装(清理旧 runtime)
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1 -Force -DshVersion 0.1.0-rc.7 -NodeVersion 24.20.0
#
# 安全策略:
#   * node.exe 下载后必须通过 SHA-256 校验(内置清单, 或动态对照官方 SHASUMS256.txt)
#   * 仅允许使用兼容矩阵里验证过的 DSH/Node 组合; 其他组合必须显式加 -Force
#   * 已有的 runtime 若版本与期望不符, 直接报错拒绝使用(加 -Force 才会重建), 防止旧 runtime 被打进安装包
param(
  [string]$NodeVersion = '24.18.0',
  [string]$DshVersion = '0.1.0-rc.7',
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

# 兼容矩阵: 只收录经过"下载 -> 打包 -> 启动"全链路验证的组合。
# 新增组合时: 先用官方 SHASUMS256.txt 确认 node.exe 哈希, 再实测打包与启动。
$Compatible = @(
  @{ Dsh = '0.1.0-rc.7'; Node = '24.18.0'; NodeSha256 = '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de' }
)

# 内置 SHA-256 清单(node 版本 -> win-x64/node.exe 官方哈希)
$NodeArtifacts = @{}
foreach ($pair in $Compatible) {
  $NodeArtifacts[$pair.Node] = $pair.NodeSha256
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

# 动态从官方 SHASUMS256.txt 取 win-x64/node.exe 的哈希(用于矩阵外的自定义版本)
function Get-OfficialNodeHash([string]$Version) {
  $url = "https://nodejs.org/dist/v$Version/SHASUMS256.txt"
  Write-Host "拉取官方校验清单: $url"
  $ProgressPreference = 'SilentlyContinue'
  $content = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
  $line = ($content -split "`n") | Where-Object { $_ -match 'win-x64/node\.exe\s*$' } | Select-Object -First 1
  if (-not $line) { throw "官方 SHASUMS256.txt 中没有 win-x64/node.exe 的记录: $url" }
  return ($line.Trim() -split '\s+')[0].ToLowerInvariant()
}

function Get-NodeExeVersion([string]$Exe) {
  if (-not (Test-Path $Exe)) { return $null }
  try { return (& $Exe --version 2>$null | Select-Object -First 1).Trim() } catch { return $null }
}

function Get-InstalledDshVersion([string]$RuntimeDir) {
  $pkg = Join-Path $RuntimeDir 'node_modules\@deepseek-ai\dsh\package.json'
  if (-not (Test-Path $pkg)) { return $null }
  return (Get-Content $pkg -Raw | ConvertFrom-Json).version
}

# ---------- 0) 兼容组合校验 ----------
$known = $Compatible | Where-Object { $_.Dsh -eq $DshVersion -and $_.Node -eq $NodeVersion }
if (-not $known -and -not $Force) {
  $list = ($Compatible | ForEach-Object { "  DSH $($_.Dsh) + Node $($_.Node)" }) -join "`n"
  throw "未验证的版本组合: DSH=$DshVersion + Node=$NodeVersion。`n已验证组合:`n$list`n确需使用未验证组合时, 请加 -Force(此时 node.exe 哈希将动态对照官方 SHASUMS256.txt)。"
}
if ($Force -and -not $known) {
  Write-Warning "使用未验证组合 DSH=$DshVersion + Node=$NodeVersion(-Force 已确认)。"
}

$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

# ---------- 1) node.exe (win-x64) ----------
$nodeExe = Join-Path $runtime 'node.exe'
$existingNodeVer = Get-NodeExeVersion $nodeExe
if ($existingNodeVer) {
  if ($existingNodeVer -ne "v$NodeVersion") {
    if (-not $Force) {
      throw "runtime 里已有 node.exe 版本 $existingNodeVer, 与期望 v$NodeVersion 不符(旧 runtime 不应被打包)。请加 -Force 重新拉取。"
    }
    Write-Host "node.exe 版本不符($existingNodeVer), -Force 强制重新下载 v$NodeVersion ..."
  } elseif (-not $Force) {
    Write-Host "node.exe v$NodeVersion 已就绪, 跳过下载"
  } else {
    Write-Host "node.exe 已存在, -Force 强制重新下载 v$NodeVersion ..."
  }
} else {
  Write-Host "下载 node.exe v$NodeVersion ..."
}
if (-not $existingNodeVer -or $Force -or $existingNodeVer -ne "v$NodeVersion") {
  $ProgressPreference = 'SilentlyContinue'
  $tmp = Join-Path $env:TEMP ("node-$NodeVersion-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.exe')
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/win-x64/node.exe" -OutFile $tmp
  # SHA-256 校验: 内置清单优先, 矩阵外版本动态对照官方 SHASUMS256.txt
  if ($NodeArtifacts.ContainsKey($NodeVersion)) {
    $want = $NodeArtifacts[$NodeVersion]
  } else {
    $want = Get-OfficialNodeHash -Version $NodeVersion
  }
  $got = Get-Sha256 $tmp
  if ($got -ne $want) {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    throw "node.exe v$NodeVersion SHA-256 校验失败:`n  期望 $want`n  实际 $got`n已删除下载文件, 请检查网络或镜像来源。"
  }
  Write-Host "node.exe SHA-256 校验通过 ($got)"
  Move-Item $tmp $nodeExe -Force
}

# ---------- 2) @deepseek-ai/dsh ----------
$installedDsh = Get-InstalledDshVersion $runtime
if ($installedDsh) {
  if ($installedDsh -ne $DshVersion) {
    if (-not $Force) {
      throw "runtime 里已安装 @deepseek-ai/dsh@$installedDsh, 与期望 $DshVersion 不符(旧 runtime 不应被打包)。请加 -Force 重新安装。"
    }
    Write-Host "@deepseek-ai/dsh 版本不符($installedDsh), -Force 清理并重装 $DshVersion ..."
  } elseif (-not $Force) {
    Write-Host "@deepseek-ai/dsh@$DshVersion 已就绪, 跳过安装"
  } else {
    Write-Host "@deepseek-ai/dsh 已存在, -Force 清理并重装 $DshVersion ..."
  }
} else {
  Write-Host "安装 @deepseek-ai/dsh@$DshVersion ..."
}
if (-not $installedDsh -or $Force -or $installedDsh -ne $DshVersion) {
  if (Test-Path (Join-Path $runtime 'node_modules')) {
    Write-Host "清理旧 runtime\node_modules ..."
    Remove-Item (Join-Path $runtime 'node_modules') -Recurse -Force
  }
  # --dangerously-allow-all-scripts 放开安装脚本(npm >= 11.3); 旧版 npm 无此策略可去掉该参数
  npm install --prefix $runtime "@deepseek-ai/dsh@$DshVersion" --no-save --no-package-lock --dangerously-allow-all-scripts
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败 (exit $LASTEXITCODE)。" }
  $after = Get-InstalledDshVersion $runtime
  if ($after -ne $DshVersion) {
    throw "@deepseek-ai/dsh 安装后版本校验失败: 期望 $DshVersion, 实际 $after。"
  }
}

# ---------- 3) 最终核对 ----------
$finalNode = Get-NodeExeVersion $nodeExe
$finalDsh = Get-InstalledDshVersion $runtime
if ($finalNode -ne "v$NodeVersion" -or $finalDsh -ne $DshVersion) {
  throw "runtime 组装结果与期望不符: node=$finalNode (期望 v$NodeVersion), dsh=$finalDsh (期望 $DshVersion)。"
}
Write-Host "runtime 就绪: node $finalNode + @deepseek-ai/dsh@$finalDsh"
Get-ChildItem $runtime | Select-Object Name, Length
