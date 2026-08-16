# DSH Desktop

> DeepSeek Harness 桌面端 —— 用原生窗口运行你本机的 dsh Web 界面：托盘常驻、独立端口、与命令行/浏览器端共享同一份插件、会话与凭据。

[![License](https://img.shields.io/badge/license-MIT-blue)](#license)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6)](#)
[![Electron](https://img.shields.io/badge/electron-37-47848F)](#)

## 它是什么

DSH Desktop 是一个 Electron 外壳：把官方 dsh Web UI 装进原生窗口。安装包内置完整运行时（Node.js 24 + DeepSeek Harness），**目标电脑无需安装任何东西**，双击即用。

- **与你的 dsh 同源**：默认使用 `~/.dsh`，插件、会话、凭据和命令行/浏览器端完全互通
- **独立实例**：未指定端口时自动挑选空闲端口，不与浏览器端的 3080 冲突
- **托盘常驻**：关窗即隐藏；托盘菜单提供「打开项目… / 服务地址 / 检查更新 / 退出」
- **会话工作目录**：托盘「打开项目…」选择并记住，新会话从你的项目目录开始
- **故障可诊断**：启动失败弹出可复制的诊断窗口（实际命令、端口探测结论、日志末尾），支持「重试启动」「打开日志」
- **自动更新**：GitHub Releases 检查（严格 SemVer）；下载后不自动执行，展示 SHA-256 供与发布页核对

## 快速开始（用户）

1. 到 [Releases](https://github.com/qaqaza11/DSH-Desktop/releases/latest) 下载 `DSH Desktop Setup x.y.z.exe` 与 `SHA256SUMS.txt`
2. 核对完整性（防下载损坏/传错，不替代签名防篡改）：`(Get-FileHash "DSH Desktop Setup x.y.z.exe").Hash` 与 `SHA256SUMS.txt` 比对
3. 运行安装包，自动创建桌面与开始菜单快捷方式

> 安装包尚未代码签名：首次运行 SmartScreen 可能提示「未知发布者」，请选择「仍要运行」（详见下方「安全与信任」）。

## 开发与构建

```powershell
git clone https://github.com/qaqaza11/DSH-Desktop.git
cd DSH-Desktop
powershell -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1   # 拉取打包运行时(node.exe + dsh, 带 SHA-256 校验)
npm install
npm start        # 开发运行
npm test         # 更新解析单元测试
npm run dist     # 打包 Windows 安装包
```

`fetch-runtime.ps1` 只允许兼容矩阵内验证过的组合（当前 DSH 0.1.0-rc.6 + Node 24.18.0）；已有 runtime 版本不符会拒绝打包（`-Force` 强制重建）。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_DESKTOP_PORT` | 自动挑选空闲端口 | 显式指定端口(1–65535)；显式设置时复用该端口已有 DSH 服务 |
| `DSH_DESKTOP_PROFILE` | `web` | dsh profile（目标 profile 需包含 `@deepseek-ai/dsh-web-app` bundle） |
| `DSH_DESKTOP_WORKDIR` | 记住的目录 → 文档目录 | 会话工作目录 |
| `DSH_DESKTOP_DSH_CMD` | 内置 runtime | 指定 dsh CLI 路径 |
| `DSH_DESKTOP_UPDATE_REPO` | `qaqaza11/DSH-Desktop`(app-update.yml) | GitHub 更新源 `owner/repo` |
| `DSH_DESKTOP_UPDATE_URL` | — | 自定义更新检查端点 |
| `DSH_DESKTOP_UPDATE_EXE_URL` | — | 直连安装包下载地址 |
| `DSH_DESKTOP_TEST_QUIT_MS` | — | 测试钩子：N 毫秒后走真实退出路径（仅 CI/验收用） |

## 自动更新

- 检查时机：启动 8 秒后 + 每 6 小时静默检查；托盘「检查更新」手动触发
- 版本判定：严格 SemVer（支持 `v` 前缀与预发布），只提示严格更新的版本
- 安全边界：接入签名/校验前，下载后**不自动执行**——弹窗展示 SHA-256（自动复制到剪贴板），引导到下载目录 / Release 页面人工核对安装
- 发布方必须同时上传 `SHA256SUMS.txt`（`scripts/make-sha256sums.ps1` 生成），否则用户没有可信的比对对象

## 安全与信任（如实说明）

- **导航安全**：同源判定用 URL origin 整段比较（防 `127.0.0.1:3080.evil.com` 类伪冒）；端口 1–65535 校验；服务探测校验 DSH 指纹（`__DSH_BOOT__`），端口被其他程序占用时不会误连
- **下载安全**：更新安装包地址仅允许 `https:`，GitHub 资产额外限制域名白名单
- **安装包未签名**：Windows SmartScreen 可能提示「未知发布者」，**不承诺"完全无提示安装"**；请从官方 Release 下载并核对 SHA-256。代码签名申请与接入见 [docs/signing.md](docs/signing.md)（打包管线已就绪，拿到证书后自动签名）

## 发布与验收

- 8 项自动化验收：`powershell -ExecutionPolicy Bypass -File scripts/acceptance.ps1`（首次启动/托盘/退出清理/端口冲突/断网更新/升级提示/自动端口/工作目录，详见 [docs/acceptance.md](docs/acceptance.md)）
- 发布流程：改版本号 → `npm run dist` → `make-sha256sums.ps1` → 推送 → 发 Release（tag `vx.y.z`，上传 exe 与 SHA256SUMS.txt）

## 目录结构

```
main.js                  Electron 主进程（服务托管/窗口/托盘/更新）
lib/                     更新解析、设置持久化、诊断窗口预加载
test/                    单元测试
docs/                    发布验收清单、代码签名接入指南
scripts/                 runtime 拉取、校验文件生成、发布验收
build/after-pack.js      打包钩子（把 dsh 运行时补进安装包）
runtime/                 打包用内置运行时（不进 git）
```

## License

[MIT](LICENSE)。架构学习自 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)，dsh 本体为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方发布物。
