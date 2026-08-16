# DSH Desktop

DeepSeek Harness 桌面端 —— 基于 Electron 的精简外壳,把官方 dsh Web UI 变成原生桌面应用。

## 零基础开箱即用

安装包内置完整 dsh 运行时(Node.js + DeepSeek Harness 全部依赖, 约 330MB),
**对方电脑无需安装任何东西**, 安装后双击即可使用。

- 打包版优先使用内置 `resources/runtime/dsh.cmd`
- 找不到内置运行时才探测本机 ai-manager 安装 / PATH 中的 dsh

## 架构(学习自 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop), 6356 stars)

| 原方案 | 本实现 |
|---|---|
| Electron main 启动官方 DSH Host, loopback HTTP 提供 UI | 主进程检测/启动本机 `dsh --profile web` 服务 |
| BrowserWindow 加载同源页面 | 加载 `http://127.0.0.1:3080` |
| 托盘常驻, 关窗隐藏 | 同左 |
| `contextIsolation` + `sandbox` + 同源导航限制 | 同左 |
| 外链交给系统浏览器 | 同左 |
| 启动后静默检查更新, 托盘手动检查 | 同左 |

## 使用

```sh
npm install     # 安装 electron
npm start       # 启动桌面应用
npm run dist    # 打包 (NSIS 安装包)
```

### 新克隆的仓库怎么构建

`runtime/`(node.exe + dsh 包, 约 330MB)和 `node_modules/`、`dist/` 都不进 git。克隆后先重建运行时再打包:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1         # 默认已验证组合(DSH 0.1.0-rc.6 + Node 24.18.0)
powershell -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1 -Force  # 强制重新下载/重装(清理旧 runtime)
npm install
npm run dist
```

`fetch-runtime.ps1` 的安全策略: node.exe 下载后做 SHA-256 校验(内置官方哈希清单, 矩阵外版本动态对照官方 SHASUMS256.txt); 只允许兼容矩阵里验证过的 DSH/Node 组合(其他组合必须显式加 `-Force`); 已有的 runtime 版本与期望不符时直接报错拒绝, 防止旧 runtime 被打进安装包。

- 启动时若指定端口没有服务, 会自动拉起 `dsh --profile <profile> --port <port>`(默认 `web` / `3080`); 端口探测会校验 DSH 的 HTML 指纹(`__DSH_BOOT__`), 端口被其他程序占用时不会误连
- 启动失败会弹出可复制的诊断窗口(实际启动命令、端口探测结论、dsh 日志末尾), 并自动复制到剪贴板; 窗口内提供「重试启动」(免退出重开)与「打开日志」按钮, 日志落盘在 `%APPDATA%\dsh-desktop\logs\dsh-desktop.log`
- 发布前验收: `powershell -ExecutionPolicy Bypass -File scripts/acceptance.ps1`(6 项自动化验收, 详见 [docs/acceptance.md](docs/acceptance.md))
- 关闭窗口 = 最小化到托盘; 托盘菜单可重新打开/退出
- 托盘菜单「检查更新」手动检查更新; 启动后 8 秒自动静默检查, 之后每 6 小时一次
- 环境变量:
  - `DSH_DESKTOP_DSH_CMD` — 指定 dsh CLI 路径
  - `DSH_DESKTOP_PORT` — 覆盖服务端口(默认 3080; 必须是 1–65535 的整数, 非法值回退 3080)
  - `DSH_DESKTOP_PROFILE` — 覆盖 dsh profile(默认 `web`, 仅允许字母/数字/`-`/`_`; 多实例时与端口一起错开, 避免与已有 3080 服务撞车)。注意: 目标 profile 必须先包含 Web 界面 bundle —— 用 `dsh plugin --profile <name> add @deepseek-ai/dsh-web-app` 创建, 或直接克隆已有的 `~/.dsh/profiles/web` 整个目录; 只有 `dsh-base` 的裸 profile 没有浏览器界面, 会一直起不来
  - `DSH_DESKTOP_UPDATE_URL` — 自定义更新检查地址(返回 `{"version":"x.y.z"}` 或 `{"tag_name":"vx.y.z"}`, 如 GitHub Releases API)
  - `DSH_DESKTOP_UPDATE_REPO` — 更省事: 填 `owner/repo`(如 `someone/dsh-desktop`), 自动使用 `https://api.github.com/repos/<owner/repo>/releases/latest` 作为更新源
  - `DSH_DESKTOP_UPDATE_EXE_URL` — 更新安装包的下载地址; 有更新时用户确认后下载保存(不自动执行, 需人工核对 SHA-256 后手动安装)
  - 以上更新源都未配置时, 会读取随包分发的 `resources/app-update.yml`(`owner`/`repo` 两个字段, 与 Oh-DSH 同款); 仍然没有则跳过检查

## 自动更新(模仿 Oh-DSH)

把 `owner`/`repo` 写进项目根目录的 `app-update.yml` 并随包发布, 或设置 `DSH_DESKTOP_UPDATE_REPO` 环境变量(本项目已配置 `qaqaza11/DSH-Desktop`):

```yaml
owner: qaqaza11
repo: DSH-Desktop
```

- 检查走 GitHub Releases API(`/releases/latest`), 兼容 `{"tag_name":"vX.Y.Z","assets":[...]}` 响应
- 版本比较用严格 SemVer(支持 `v` 前缀与预发布版本); 有更新时弹窗确认后下载安装包
- 安全边界: 在接入代码签名或 SHA-256 自动校验之前, 下载后**不自动执行安装包** —— 弹出文件 SHA-256(自动复制到剪贴板)供与 Release 页面核对, 并提供「打开所在文件夹 / 查看 Release 页面」入口, 由用户手动安装
- 安装包选择顺序: 资产名含 `setup` > 含 `portable` > 任意 `.exe`; 也支持 `DSH_DESKTOP_UPDATE_EXE_URL` 直连
- 发布流程: `npm run dist` → `powershell -ExecutionPolicy Bypass -File scripts/make-sha256sums.ps1` 生成 `dist/SHA256SUMS.txt` → 把 `DSH Desktop Setup x.y.z.exe` **与 `SHA256SUMS.txt` 一起**作为 release 资产上传(这是用户比对安装包 SHA-256 的可信依据, 缺失时客户端展示的校验值没有比对对象), tag 用 `vx.y.z` 即可

## Windows 信任与代码签名(如实说明)

- **当前安装包未签名**: Windows SmartScreen 可能提示「未知发布者」, 浏览器下载后可能提示"保留"; **本项目不承诺"完全无提示安装"**。缓解方式: 只从 GitHub Releases 官方渠道下载, 并核对页面公布的 SHA-256(应用内更新下载后也会自动把校验值复制到剪贴板)
- 打包管线已按 electron-builder 标准支持代码签名(PFX 证书用 `CSC_LINK`/`CSC_KEY_PASSWORD` 环境变量, 或 Azure Trusted Signing 的 `win.azureSignOptions`), 拿到证书后 `npm run dist` 自动签名, 无需改代码。申请与接入步骤见 [docs/signing.md](docs/signing.md)
- 如实预期: 代码签名解决"发布者身份与防篡改", 但**新证书初期 SmartScreen 仍可能出现提示**(信誉需要时间与下载量积累), 请在文档/Release 中如实告知用户

## 产物

打包输出在 `dist/`:

- `DSH Desktop Setup 0.1.1.exe` — 安装包(可选安装目录, 含卸载器, 自动创建桌面/开始菜单快捷方式), 适合分享给别人
- 上传 GitHub Release 时以本文件作为资产, tag 用 `vx.y.z`(见上方自动更新说明)

## 目录

```
main.js                Electron 主进程(服务托管 + 窗口 + 托盘 + 更新检查)
lib/update.js          SemVer 版本比较与更新响应解析(纯函数, 可单测)
test/update.test.mjs   更新解析单元测试(node test/update.test.mjs)
assets/                应用图标与托盘图标
app-update.yml         自动更新源(owner/repo, 随包分发; 发布前填好)
scripts/fetch-runtime.ps1  拉取打包用运行时(node.exe + dsh 包), 克隆后先跑它
build/after-pack.js    打包钩子(把 dsh 运行时补进包, 绕过 electron-builder 的 node_modules 过滤)
runtime/               内置运行时(node.exe + dsh 包), 仅打包用, 不进 git
```
