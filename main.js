// DSH Desktop — DeepSeek Harness 桌面端外壳
// 架构参考: github.com/anywhere-labs/deepseek-harness-desktop (Electron 壳 + 托管本地 dsh 服务)
// 职责: 1) 确保本地 dsh web 服务在运行  2) BrowserWindow 加载同源 UI  3) 托盘常驻

'use strict'

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, net } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { Readable } = require('node:stream')
const { parseUpdateResponse } = require('./lib/update.js')

// ---------- 配置 ----------
// 端口可通过环境变量 DSH_DESKTOP_PORT 覆盖(便于测试/多实例);
// 必须是 1–65535 的整数, 非法值一律回退默认 3080
function parsePort(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 3080
}
const DSH_WEB_PORT = parsePort(process.env.DSH_DESKTOP_PORT)
// profile 可通过环境变量 DSH_DESKTOP_PROFILE 覆盖(默认 web; 仅允许字母/数字/-/_, 防止 shell 注入与断词)
const DSH_PROFILE = /^[A-Za-z0-9_-]{1,64}$/.test(process.env.DSH_DESKTOP_PROFILE || '')
  ? process.env.DSH_DESKTOP_PROFILE
  : 'web'
const WEB_URL = `http://127.0.0.1:${DSH_WEB_PORT}`
// 同源判定基准: 用 URL origin(协议+主机+端口)整段比较, 而不是字符串前缀,
// 避免 "http://127.0.0.1:3080.evil.com"、"http://127.0.0.1:30800" 这类形似地址被嵌入窗口
const WEB_ORIGIN = new URL(WEB_URL).origin
function isSameOrigin(targetUrl) {
  try {
    return new URL(String(targetUrl)).origin === WEB_ORIGIN
  } catch {
    return false // 无法解析(about:blank / data: 等)一律视为非同源
  }
}
const APP_NAME = 'DSH Desktop'

let mainWindow = null
let tray = null
let childProcess = null
let quitting = false

// ---------- 单实例 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })
  app.whenReady().then(main)
}

// ---------- 资源路径(兼容 asar 打包) ----------
function assetPath(name) {
  // 打包后图标通过 extraResources 放在 resources/assets; 开发时在项目 assets/
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, 'assets')
  return path.join(base, name)
}

// ---------- dsh CLI 探测 ----------
// 候选顺序: 环境变量 -> 打包内置 runtime(开箱即用) -> ai-manager 安装的 dsh -> PATH 中的 dsh
function findDshCmd() {
  const env = process.env.DSH_DESKTOP_DSH_CMD
  if (env && fs.existsSync(env)) return env

  // 打包内置: resources/runtime/dsh.cmd(与 node.exe、dsh 包一起分发)
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'runtime', 'dsh.cmd')
    if (fs.existsSync(bundled)) return bundled
  }

  const home = process.env.USERPROFILE || process.env.HOME
  if (home) {
    const runtimesDir = path.join(home, '.ai-manager', 'runtimes', 'node')
    try {
      if (fs.existsSync(runtimesDir)) {
        const versions = fs.readdirSync(runtimesDir).sort().reverse()
        for (const v of versions) {
          const candidate = path.join(runtimesDir, v, 'dsh.cmd')
          if (fs.existsSync(candidate)) return candidate
        }
      }
    } catch { /* ignore */ }
  }

  try {
    const out = execFileSync('where', ['dsh'], { encoding: 'utf8', windowsHide: true })
    const first = out.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0)
    if (first) return first
  } catch { /* not on PATH */ }

  return null
}

const DSH_CMD = findDshCmd()

// ---------- 服务探测 ----------
function isServiceUp(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get({ host, port, timeout: 1500 }, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

async function waitForService(port, timeoutMs = 30000, childRef = null) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isServiceUp(port)) return true
    // 若启动的 dsh 进程已退出, 提前结束等待, 让上层尽快重试
    if (childRef && (childRef.exitCode !== null || childRef.signalCode !== null)) return false
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

// ---------- 启动本地 dsh web ----------
let serviceReady = false // 服务是否已就绪(用于区分启动期崩溃 vs 运行期崩溃)

function startDshService() {
  if (!DSH_CMD || !fs.existsSync(DSH_CMD)) {
    console.error(`未找到 dsh CLI (DSH_CMD=${DSH_CMD})`)
    return null
  }
  console.log(`启动 dsh: ${DSH_CMD} --profile ${DSH_PROFILE} --port ${DSH_WEB_PORT}`)
  // .cmd 入口在 Windows 上需要 shell: true 才能被 spawn 执行;
  // 路径含空格(如 AppData\Local\Programs\DSH Desktop)时必须加引号, 否则 cmd 截断命令
  const command = process.platform === 'win32' ? `"${DSH_CMD}"` : DSH_CMD
  const child = spawn(command, ['--profile', DSH_PROFILE, '--port', String(DSH_WEB_PORT)], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32',
  })
  child.on('error', (err) => {
    console.error(`dsh 进程启动失败: ${err.message}`)
  })
  // spawn 失败时 stdout/stderr 可能为 null, 需防御
  if (child.stdout) child.stdout.on('data', (d) => process.stdout.write(`[dsh] ${d}`))
  if (child.stderr) child.stderr.on('data', (d) => process.stderr.write(`[dsh] ${d}`))
  child.on('exit', (code, signal) => {
    console.log(`dsh 进程退出: code=${code} signal=${signal}`)
    // 只在服务已就绪后的崩溃才弹窗; 启动期的退出由 ensureService 静默重试处理
    // (首次启动 dsh 需一次性初始化, 可能中途退出一次, 直接报错会误导用户)
    if (!quitting && serviceReady) {
      dialogError('dsh 服务已退出', `服务进程已退出 (code=${code})。\n可尝试重新打开应用。`)
    }
  })
  return child
}

// 确保服务就绪: 已有服务直接连; 没有则拉起并带重试(首次启动初始化慢/中途退出都静默处理)
async function ensureService() {
  if (await isServiceUp(DSH_WEB_PORT)) {
    serviceReady = true
    return true
  }
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`[ensureService] 第 ${attempt}/${MAX_ATTEMPTS} 次启动 dsh`)
    childProcess = startDshService()
    if (!childProcess) return false // 找不到 dsh CLI, 重试无意义
    const up = await waitForService(DSH_WEB_PORT, 60000, childProcess)
    if (up) {
      serviceReady = true
      return true
    }
    console.log(`[ensureService] 第 ${attempt} 次等待超时`)
    killChildTree()
    await new Promise((r) => setTimeout(r, 3000))
  }
  return false
}

function dialogError(title, detail) {
  try { dialog.showErrorBox(title, detail) } catch { /* ignore */ }
}

// ---------- 窗口 ----------
function createWindow() {
  const iconPath = assetPath('app-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  // 关窗即隐藏到托盘(学习 anywhere-labs 的托盘常驻行为)
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })

  // 仅允许同源导航(origin 整段比较), 外部链接交给系统浏览器
  mainWindow.webContents.on('will-frame-navigate', (event, url) => {
    const target = typeof url === 'string' ? url : event && event.url
    if (!isSameOrigin(target)) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    const target = typeof url === 'string' ? url : event && event.url
    if (!isSameOrigin(target)) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  // Windows 上 preventDefault 无法阻止标题更新(实测), 需手动恢复固定标题
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(APP_NAME)
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  // 先显示本地占位页(启动中), 服务就绪后由 main() 加载真实界面
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml()))
    .catch((err) => console.error(`占位页加载失败: ${err.message}`))
}

// 启动中的占位页面
function loadingHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>DSH Desktop</title>
<style>
  body { margin:0; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
         background:#1e2228; color:#cdd4de; font-family:'Microsoft YaHei',sans-serif; }
  .spinner { width:36px; height:36px; border:4px solid #3a414c; border-top-color:#4d9fff; border-radius:50%;
             animation:spin 1s linear infinite; margin-bottom:20px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .title { font-size:20px; font-weight:bold; margin-bottom:8px; }
  .hint { font-size:14px; color:#8b95a3; }
</style></head>
<body>
  <div class="spinner"></div>
  <div class="title">DeepSeek Harness</div>
  <div class="hint">正在启动服务, 首次启动可能需要一两分钟, 请稍候…</div>
</body></html>`
}

// ---------- 托盘 ----------
function createTray() {
  // 基础 16x16 + 多 DPI 表示(@1.25x/@1.5x/@2x), 高分屏不模糊
  let icon = nativeImage.createFromPath(assetPath('tray-icon.png'))
  if (process.platform === 'win32') {
    icon = icon.resize({ width: 16, height: 16 })
    for (const [scale, file] of [
      [1.25, 'tray-icon@1.25x.png'],
      [1.5, 'tray-icon@1.5x.png'],
      [2.0, 'tray-icon@2x.png'],
    ]) {
      const rep = nativeImage.createFromPath(assetPath(file))
      if (!rep.isEmpty()) {
        icon.addRepresentation({ scaleFactor: scale, buffer: rep.toPNG() })
      }
    }
  }
  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)
  const menu = Menu.buildFromTemplate([
    { label: `打开 ${APP_NAME}`, click: () => showWindow() },
    { type: 'separator' },
    { label: '打开服务地址', click: () => shell.openExternal(WEB_URL) },
    { label: '检查更新', click: () => { void checkForUpdates({ manual: true }) } },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => showWindow())
}

function showWindow() {
  // 窗口可能已被销毁(如系统回收), 重建即可
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// ---------- 更新检查 ----------
// 模仿 Oh-DSH 的 GitHub Releases 自动更新。更新源按优先级解析:
//   1) DSH_DESKTOP_UPDATE_URL     自定义 JSON 端点(返回 {"version":"x.y.z"} 或 {"tag_name":"vx.y.z"})
//   2) DSH_DESKTOP_UPDATE_REPO    如 "owner/repo", 自动使用 GitHub Releases API(latest) 作为更新源
//   3) resources/app-update.yml   owner/repo 两个字段(与 Oh-DSH 同款), 随安装包分发、无需环境变量
// 三者都未配置时检查直接跳过。
const UPDATE_REPO = process.env.DSH_DESKTOP_UPDATE_REPO || ''
function readAppUpdateRepo() {
  try {
    const p = path.join(process.resourcesPath, 'app-update.yml')
    if (!fs.existsSync(p)) return ''
    const text = fs.readFileSync(p, 'utf8')
    const owner = (text.match(/^owner:\s*(.+)$/m) || [])[1]?.trim() || ''
    const repo = (text.match(/^repo:\s*(.+)$/m) || [])[1]?.trim() || ''
    return owner && repo ? `${owner}/${repo}` : ''
  } catch { return '' }
}
const APP_UPDATE_REPO = UPDATE_REPO || readAppUpdateRepo()
const UPDATE_URL = process.env.DSH_DESKTOP_UPDATE_URL
  || (APP_UPDATE_REPO ? `https://api.github.com/repos/${APP_UPDATE_REPO}/releases/latest` : '')
const CURRENT_VERSION = app.getVersion()
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 每 6 小时静默检查一次(与 electron-updater 习惯一致)

let updateDialogOpen = false

async function checkForUpdates({ manual = false } = {}) {
  if (!UPDATE_URL) {
    if (manual) dialogError('未配置更新源', '请设置环境变量 DSH_DESKTOP_UPDATE_REPO(如 owner/repo)、DSH_DESKTOP_UPDATE_URL, 或随包提供 app-update.yml 后重试。')
    return
  }
  if (updateDialogOpen) return
  try {
    const res = await net.fetch(UPDATE_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (res.status !== 200) {
      if (manual) dialogError('检查更新失败', `更新服务返回 HTTP ${res.status}`)
      return
    }
    const body = await res.text()
    const result = parseUpdateResponse(body, CURRENT_VERSION)
    if (result === null) {
      if (manual) dialogError('检查更新失败', '更新服务返回了无法解析的数据。')
      return
    }
    if (result.status === 'update-available') {
      updateDialogOpen = true
      try {
        const choice = await dialog.showMessageBox({
          type: 'info',
          title: '发现新版本',
          message: `${APP_NAME} ${result.latestVersion} 已发布`,
          detail: `当前版本: ${result.currentVersion}\n是否下载安装包?`,
          buttons: ['下载', '稍后'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
        if (choice.response === 0) {
          await downloadAndOpenUpdate(result.latestVersion, result.assets)
        }
      } finally {
        updateDialogOpen = false
      }
    } else if (manual) {
      await dialog.showMessageBox({
        type: 'info',
        title: '已是最新版本',
        message: `${APP_NAME} ${result.currentVersion}`,
        detail: '当前已是最新版本。',
        buttons: ['OK'],
        noLink: true,
      })
    }
  } catch (err) {
    console.error(`检查更新失败: ${err.message}`)
    if (manual) dialogError('检查更新失败', `${err.message}`)
  }
}

async function downloadAndOpenUpdate(latestVersion, assets = []) {
  const installers = resolveInstallerUrls(latestVersion, assets)
  if (installers.length === 0) {
    dialogError('无法下载更新', '更新服务未提供安装包下载地址。')
    return
  }
  // 优先 NSIS 安装包, 其次便携版
  const target = installers.find((u) => u.toLowerCase().includes('setup'))
    ?? installers.find((u) => u.toLowerCase().includes('portable'))
    ?? installers[0]

  const destDir = path.join(app.getPath('downloads'), 'DSH-Desktop-Updates')
  fs.mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, `DSH-Desktop-${latestVersion}-installer.exe`)

  const res = await net.fetch(target, { method: 'GET', cache: 'no-store' })
  if (!res.ok) {
    dialogError('下载失败', `HTTP ${res.status}`)
    return
  }
  const tmp = path.join(os.tmpdir(), `dsh-update-${Date.now()}.exe`)
  // 流式落盘: 安装包动辄上百 MB, 避免整体缓冲进内存
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp)
    Readable.fromWeb(res.body).pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
  })
  fs.copyFileSync(tmp, dest)
  fs.unlinkSync(tmp)

  const choice = await dialog.showMessageBox({
    type: 'info',
    title: '更新已下载',
    message: `DSH Desktop ${latestVersion} 安装包已下载`,
    detail: `位置: ${dest}\n\n立即运行安装程序?`,
    buttons: ['立即安装', '打开所在文件夹', '稍后'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })
  if (choice.response === 0) {
    // 先退出本应用再运行安装器: 否则 NSIS 无法覆盖正在运行的主程序文件
    // (与 electron-updater 的"退出后安装"行为一致)
    quitApp()
    spawn(dest, ['--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).on('error', (err) => {
      dialogError('启动安装程序失败', err.message)
    }).unref()
  } else if (choice.response === 1) {
    shell.showItemInFolder(dest)
  }
}

// 从更新响应中提取可能的安装包 URL:
//   1) DSH_DESKTOP_UPDATE_EXE_URL 环境变量
//   2) GitHub Releases API 返回的 assets: 优先含 setup 的, 其次 portable, 再任意 .exe
function resolveInstallerUrls(latestVersion, assets = []) {
  const urls = []
  if (process.env.DSH_DESKTOP_UPDATE_EXE_URL) urls.push(process.env.DSH_DESKTOP_UPDATE_EXE_URL)
  const list = (Array.isArray(assets) ? assets : [])
    .map(a => (a && typeof a.browser_download_url === 'string') ? a.browser_download_url : '')
    .filter(Boolean)
  const find = kw => list.find(u => u.toLowerCase().includes(kw))
  const fallback = find('setup') ?? find('portable') ?? list.find(u => /\.exe$/i.test(u))
  if (fallback) urls.push(fallback)
  return urls
}
// ---------- 生命周期 ----------
async function main() {
  app.setName(APP_NAME)

  // 1) 先创建窗口(显示"正在启动服务"占位页), 避免用户面对空白
  createWindow()

  // 2) 确保本地服务在运行(带重试, 首次启动初始化慢/中途退出都静默处理)
  const up = await ensureService()
  if (!up) {
    dialogError('无法启动 dsh 服务', '已多次尝试启动, 均失败。\n请重新打开应用重试, 或联系开发者。')
    app.quit()
    return
  }
  console.log(`dsh web 已就绪: ${WEB_URL} (profile: ${DSH_PROFILE})`)

  // 3) 加载真实界面 + 托盘
  mainWindow.loadURL(WEB_URL).catch((err) => {
    console.error(`页面加载失败: ${err.message}`)
    dialogError('页面加载失败', `无法加载 ${WEB_URL}\n${err.message}`)
  })
  createTray()

  app.on('activate', () => showWindow())

  // 4) 启动后 8 秒自动检查更新(静默, 无更新不打扰); 之后每 6 小时静默检查一次
  setTimeout(() => { void checkForUpdates({ manual: false }) }, 8000)
  setInterval(() => { void checkForUpdates({ manual: false }) }, AUTO_CHECK_INTERVAL_MS)
}

function quitApp() {
  quitting = true
  killChildTree()
  app.quit()
}

// 杀掉应用自拉起的 dsh 进程树(cmd + 其下的 node), 避免残留
function killChildTree() {
  if (!childProcess || childProcess.killed) return
  try {
    execFileSync('taskkill', ['/pid', String(childProcess.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  } catch {
    try { childProcess.kill() } catch { /* ignore */ }
  }
  childProcess = null
}

app.on('before-quit', () => {
  quitting = true
  killChildTree()
})

app.on('window-all-closed', () => {
  // 托盘常驻, 不退出(仅 quitApp 时真正退出)
})
