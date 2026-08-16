# 生成 Release 资产校验文件 dist/SHA256SUMS.txt(sha256sum 格式),
# 供用户/更新器比对安装包哈希 —— 本地计算的 SHA-256 只有与发布端公布值一致才有意义。
# 用法: powershell -ExecutionPolicy Bypass -File scripts/make-sha256sums.ps1
param(
  [string[]]$Files
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Files -or $Files.Count -eq 0) {
  $Files = Get-ChildItem (Join-Path $root 'dist') -Filter '*.exe' -File |
    Where-Object { $_.Name -notmatch 'uninstaller' } |
    Select-Object -ExpandProperty FullName
}
if ($Files.Count -eq 0) { throw 'dist 下没有可校验的 exe, 请先 npm run dist。' }

$lines = foreach ($f in $Files) {
  $h = (Get-FileHash -Algorithm SHA256 -Path $f).Hash.ToLowerInvariant()
  "$h  $(Split-Path $f -Leaf)"
}
$out = Join-Path $root 'dist\SHA256SUMS.txt'
$lines | Set-Content $out -Encoding ascii
Write-Host "已生成 $out"
$lines
