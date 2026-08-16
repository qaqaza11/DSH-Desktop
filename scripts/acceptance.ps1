# 最小发布验收: 在"干净用户环境"下对已安装的 DSH Desktop 做 6 项验收
#
# 环境定义(模拟全新 Windows 用户, 无需真实新建账号):
#   * 每次验收使用独立的 DSH_HOME 临时目录(全新 dsh 数据)
#   * 每次验收使用独立的 --user-data-dir(全新 Electron 配置/日志)
#   * 端口相互错开, 避免与本机既有 DSH(3080)互相干扰
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts/acceptance.ps1                 # 默认验收 %LOCALAPPDATA%\Programs\DSH Desktop\DSH Desktop.exe
#   powershell -ExecutionPolicy Bypass -File scripts/acceptance.ps1 -AppExe <路径>
#
# 说明: 验收需要本机可以运行 node(本地 mock 服务)。"退出"通过应用内置的
# DSH_DESKTOP_TEST_QUIT_MS 测试钩子走真实 quitApp -> killChildTree 路径。
param(
  [string]$AppExe = "$env:LOCALAPPDATA\Programs\DSH Desktop\DSH Desktop.exe"
)
$ErrorActionPreference = 'Continue'
$scriptRoot = Split-Path -Parent $PSScriptRoot
$results = [System.Collections.Generic.List[object]]::new()

function Assert([string]$Name, [bool]$Ok, [string]$Detail = '') {
  $results.Add([pscustomobject]@{ Item = $Name; Result = $(if ($Ok) { 'PASS' } else { 'FAIL' }); Detail = $Detail })
  Write-Host ("[{0}] {1} {2}" -f $(if ($Ok) { 'PASS' } else { 'FAIL' }), $Name, $Detail)
}

function New-CleanEnv([string]$Tag, [int]$Port) {
  $base = Join-Path $env:TEMP "dsd-accept-$Tag"
  Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue
  $dshHome = Join-Path $base 'dsh-home'
  $ud = Join-Path $base 'user-data'
  New-Item -ItemType Directory -Force -Path $dshHome, $ud | Out-Null
  return @{ Base = $base; Home = $dshHome; UserData = $ud; Port = $Port; Log = Join-Path $ud 'logs\dsh-desktop.log' }
}

function Start-TestApp([hashtable]$cfg) {
  $launchArgs = @("--user-data-dir=$($cfg.UserData)")
  $p = Start-Process -FilePath $AppExe -ArgumentList $launchArgs -PassThru
  return $p
}

function Wait-For([scriptblock]$Cond, [int]$TimeoutSec, [int]$IntervalSec = 3) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (& $Cond) { return $true }
    Start-Sleep $IntervalSec
  }
  return $false
}

function Wait-DshHttp([int]$Port, [int]$TimeoutSec) {
  return Wait-For { try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 3; $r.StatusCode -eq 200 -and $r.Content -match '__DSH_BOOT__' } catch { $false } } $TimeoutSec
}

function Stop-TestApp([int]$ProcId) {
  Get-Process -Id $ProcId -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Kill-StrayDsh([string]$Match) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match $Match } |
    ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>&1 | Out-Null }
}

# 本地 mock HTTP 服务(Start-Job 在当前沙箱下会因管道限制死亡, 改用 Start-Process + 文件重定向)
function Start-MockServer([int]$Port, [string]$BodyExpr, [string]$ContentType, [hashtable]$cfg) {
  $js = "require('http').createServer((req,res)=>{res.setHeader('content-type','$ContentType');res.on('error',()=>{});res.end($BodyExpr)}).listen($Port,'127.0.0.1')"
  $p = Start-Process -FilePath 'node' -ArgumentList @('-e', $js) `
    -RedirectStandardOutput (Join-Path $cfg.Base 'mock.out.log') `
    -RedirectStandardError (Join-Path $cfg.Base 'mock.err.log') `
    -WindowStyle Hidden -PassThru
  return $p
}

function Wait-Mock([int]$Port, [int]$TimeoutSec) {
  return Wait-For { try { (Invoke-WebRequest -Uri "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } } $TimeoutSec
}

function Close-MainWindow([int]$ProcId) {
  # 给主窗口发 WM_CLOSE, 触发应用的"关窗隐藏到托盘"路径
  $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
  if (-not $p -or $p.MainWindowHandle -eq 0) { return }
  $sig = '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);'
  $type = Add-Type -MemberDefinition $sig -Name 'DSDAcceptPost' -Namespace 'DSDAccept' -PassThru
  [void]$type::PostMessage($p.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
}

function Assert-WindowHidden([int]$ProcId, [int]$TimeoutSec = 8) {
  return Wait-For {
    $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
    (-not $p) -or $p.MainWindowHandle -eq 0 -or [string]::IsNullOrEmpty($p.MainWindowTitle)
  } $TimeoutSec 2
}

if (-not (Test-Path $AppExe)) {
  Write-Host "未找到待验收应用: $AppExe`n请先安装 dist\DSH Desktop Setup *.exe(静默安装: 安装包 /S)。"
  exit 2
}
Write-Host "待验收应用: $AppExe"
Write-Host "版本: $((Get-Item $AppExe).VersionInfo.ProductVersion)"

# ---------- 1+2+3) 首次启动 / 关闭到托盘 / 退出清理(同一实例) ----------
Write-Host "`n== A/B/C: 首次启动 -> 关闭到托盘 -> 退出清理 =="
$envA = New-CleanEnv 'abc' 3201
$env:DSH_HOME = $envA.Home
$env:DSH_DESKTOP_PORT = [string]$envA.Port
$env:DSH_DESKTOP_TEST_QUIT_MS = '120000'   # 120s 后自动走真实退出路径
$app = Start-TestApp $envA
$firstOk = Wait-For { (Get-Process -Id $app.Id -ErrorAction SilentlyContinue) } 15
if ($firstOk) {
  $svcA = Wait-DshHttp $envA.Port 100
  $titleA = (Get-Process -Id $app.Id -ErrorAction SilentlyContinue).MainWindowTitle
  Assert 'A 首次启动(窗口+服务+DSH 指纹)' ($svcA -and $titleA -eq 'DSH Desktop') "服务=$svcA 标题='$titleA' 端口 $($envA.Port)"
} else {
  Assert 'A 首次启动(窗口+服务+DSH 指纹)' $false '应用进程未存活'
}
# 关闭到托盘: 给主窗口发 WM_CLOSE
Close-MainWindow $app.Id
$hidden = Assert-WindowHidden $app.Id 10
$aliveAfterClose = [bool](Get-Process -Id $app.Id -ErrorAction SilentlyContinue)
$svcAfterClose = Wait-DshHttp $envA.Port 8
Assert 'B 关闭到托盘(进程与 DSH 服务仍在, 窗口隐藏)' ($hidden -and $aliveAfterClose -and $svcAfterClose) "隐藏=$hidden 进程存活=$aliveAfterClose 服务存活=$svcAfterClose"
# 退出清理: 等测试钩子触发 quitApp; 之后不应再有指向 resources\runtime 的 DSH 子进程
$dshChildBefore = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'resources\\runtime' -and $_.CommandLine -match [string]$envA.Port } | Measure-Object).Count
$quitOk = Wait-For { -not (Get-Process -Id $app.Id -ErrorAction SilentlyContinue) } 120
Start-Sleep 2
$dshChildAfter = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'resources\\runtime' -and $_.CommandLine -match [string]$envA.Port } | Measure-Object).Count
Assert 'C 退出后应用进程与 DSH 子进程均清理' ($quitOk -and $dshChildAfter -eq 0) "应用退出=$quitOk, 退出前子进程=$dshChildBefore, 退出后=$dshChildAfter"
Kill-StrayDsh ([string]$envA.Port)

# ---------- 4) 端口冲突 ----------
Write-Host "`n== D: 端口冲突 =="
$envD = New-CleanEnv 'd' 3202
$fake = Start-MockServer 3202 "'not-dsh'" 'text/plain' $envD
$mockUp = Wait-Mock 3202 10
$env:DSH_HOME = $envD.Home
$env:DSH_DESKTOP_PORT = '3202'
Remove-Item Env:\DSH_DESKTOP_TEST_QUIT_MS -ErrorAction SilentlyContinue
$appD = Start-TestApp $envD
$diagOk = Wait-For {
  $t = Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty MainWindowTitle
  $t -contains '无法启动 dsh 服务'
} 120
Assert 'D 端口被其他程序占用时弹诊断窗(不误连)' ($mockUp -and $diagOk) "mock 就绪=$mockUp, 诊断窗口=$diagOk"
Stop-TestApp $appD.Id
Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue
Kill-StrayDsh '3202'

# ---------- 5) 断网检查更新 ----------
Write-Host "`n== E: 断网检查更新 =="
$envE = New-CleanEnv 'e' 3203
$env:DSH_HOME = $envE.Home
$env:DSH_DESKTOP_PORT = '3203'
$env:DSH_DESKTOP_UPDATE_URL = 'http://127.0.0.1:9/update.json'  # 必连不上 = 模拟断网
$env:DSH_DESKTOP_TEST_QUIT_MS = '60000'
$appE = Start-TestApp $envE
$svcE = Wait-DshHttp $envE.Port 90
$offlineOk = Wait-For { (Test-Path $envE.Log) -and (Select-String -Path $envE.Log -Pattern '检查更新失败' -Quiet -ErrorAction SilentlyContinue) } 50
Assert 'E 断网检查更新(静默失败, 记录日志, 应用不崩)' ($svcE -and $offlineOk) "服务=$svcE 日志记录失败=$offlineOk"
Wait-For { -not (Get-Process -Id $appE.Id -ErrorAction SilentlyContinue) } 60 | Out-Null
Stop-TestApp $appE.Id
Kill-StrayDsh '3203'

# ---------- 6) 升级提示 ----------
Write-Host "`n== F: 升级提示 =="
$envF = New-CleanEnv 'f' 3204
$mock = Start-MockServer 3210 "JSON.stringify({version:'9.9.9'})" 'application/json' $envF
$mockUpF = Wait-Mock 3210 10
$env:DSH_HOME = $envF.Home
$env:DSH_DESKTOP_PORT = '3204'
$env:DSH_DESKTOP_UPDATE_URL = 'http://127.0.0.1:3210/update.json'
$env:DSH_DESKTOP_TEST_QUIT_MS = '60000'
$appF = Start-TestApp $envF
$svcF = Wait-DshHttp $envF.Port 90
$upgradeOk = Wait-For { (Test-Path $envF.Log) -and (Select-String -Path $envF.Log -Pattern '发现新版本: 9.9.9' -Quiet -ErrorAction SilentlyContinue) } 50
Assert 'F 更新源有新版本时触发升级提示流程' ($mockUpF -and $svcF -and $upgradeOk) "mock 就绪=$mockUpF, 服务=$svcF, 检测到升级=$upgradeOk"
Wait-For { -not (Get-Process -Id $appF.Id -ErrorAction SilentlyContinue) } 60 | Out-Null
Stop-TestApp $appF.Id
Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
Kill-StrayDsh '3204'

# ---------- 汇总 ----------
Write-Host "`n===== 验收汇总 ====="
$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = ($results | Where-Object { $_.Result -eq 'FAIL' }).Count
Write-Host "通过 $($results.Count - $failed)/$($results.Count)"
exit $(if ($failed -gt 0) { 1 } else { 0 })
