# DSH Desktop

**DeepSeek Harness 的 Windows 桌面版** —— 保留web界面并封装为桌面端，一键下载且保留原版使用体验。

## 下载安装

1. 打开 [下载页面](https://github.com/qaqaza11/DSH-Desktop/releases/latest)
2. 下载 `DSH Desktop Setup x.y.z.exe`
3. 双击安装 → 桌面出现「DSH Desktop」图标 → 启动
   
   效果： <img width="1902" height="1172" alt="屏幕截图 2026-08-17 102211" src="https://github.com/user-attachments/assets/64d1720c-03aa-4a51-bc11-bb4de1dd1011" />
    <img width="749" height="540" alt="屏幕截图 2026-08-17 102531" src="https://github.com/user-attachments/assets/9218d7ca-2438-402d-9587-0821530e99b1" />
    <img width="749" height="540" alt="屏幕截图 2026-08-17 102554" src="https://github.com/user-attachments/assets/dfd53869-d1a5-49cc-936a-85d08a93eb6a" />
    <img width="749" height="540" alt="屏幕截图 2026-08-17 102400" src="https://github.com/user-attachments/assets/b76f1a60-ea1b-46db-9ec5-d637c49277f4" />


> 首次运行如果 Windows 提示「未知发布者」（安装包暂未代码签名），点「仍要运行」即可。



## 特点

- **零依赖**：安装包自带 Node.js 和 DSH 运行时，对方电脑无需任何环境
- **和网页版数据互通**：插件、会话、登录凭据与你的命令行/浏览器 dsh 共用同一份
- **独立不冲突**：自动挑选空闲端口，不跟浏览器里的 dsh 抢 3080
- **关窗不退出**：最小化到系统托盘；托盘右键可「打开项目… / 检查更新 / 退出」
- **出问题看得懂**：启动失败弹诊断窗口，可复制错误信息、一键「重试启动」、「打开日志」
- **自动更新**：后台检查 GitHub 新版本并提示（下载后由你手动安装，不会偷偷执行）

## 常见问题

- **和网页版有区别吗？** 没有本质区别——同一个界面、同一份数据；桌面版多了独立窗口、托盘和自动更新。
- **会显示别人的会话吗？** 不会。桌面版默认用空闲端口独立运行；只有显式设置 `DSH_DESKTOP_PORT` 时才复用该端口已有服务。
- **提示「无法启动 dsh 服务」？** 点诊断窗口里的「重试启动」；仍失败就「打开日志」看末尾错误（最常见是端口被其他程序占用）。
- **怎么换项目目录？** 托盘右键 →「打开项目…」选个文件夹，新会话就从那里开始。

---

## 开发文档

> 以下是技术细节，普通用户不需要看。

### 构建

```powershell
git clone https://github.com/qaqaza11/DSH-Desktop.git
cd DSH-Desktop
powershell -ExecutionPolicy Bypass -File scripts/fetch-runtime.ps1   # 拉取打包运行时(node.exe + dsh, 带 SHA-256 校验)
npm install
npm start        # 开发运行
npm test         # 单元测试
npm run dist     # 打包 Windows 安装包
```

`fetch-runtime.ps1` 只允许兼容矩阵内验证过的版本组合（当前 DSH 0.1.0-rc.6 + Node 24.18.0）；已有 runtime 版本不符会拒绝打包（`-Force` 强制重建）。

### 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_DESKTOP_PORT` | 自动挑选空闲端口 | 显式指定端口(1–65535)；显式设置时复用该端口已有 DSH 服务 |
| `DSH_DESKTOP_PROFILE` | `web` | dsh profile（需包含 `@deepseek-ai/dsh-web-app` bundle） |
| `DSH_DESKTOP_WORKDIR` | 记住的目录 → 文档目录 | 会话工作目录 |
| `DSH_DESKTOP_DSH_CMD` | 内置 runtime | 指定 dsh CLI 路径 |
| `DSH_DESKTOP_UPDATE_REPO` | `qaqaza11/DSH-Desktop` | GitHub 更新源 `owner/repo` |
| `DSH_DESKTOP_UPDATE_URL` | — | 自定义更新检查端点 |
| `DSH_DESKTOP_UPDATE_EXE_URL` | — | 直连安装包下载地址 |
| `DSH_DESKTOP_TEST_QUIT_MS` | — | 测试钩子：N 毫秒后走真实退出路径（仅 CI/验收） |

### 自动更新

- 检查时机：启动 8 秒后 + 每 6 小时静默检查；托盘「检查更新」手动触发
- 版本判定：严格 SemVer（支持 `v` 前缀与预发布），只提示严格更新的版本
- 安全边界：接入签名/校验前，下载后**不自动执行**——弹窗展示 SHA-256（自动复制到剪贴板），由你核对后手动安装
- 发布方须在 Release 正文公布安装包 SHA-256（`scripts/make-sha256sums.ps1` 可生成），否则用户没有比对对象

### 安全与信任（如实说明）

- 导航安全：同源判定用 URL origin 整段比较；端口 1–65535 校验；服务探测校验 DSH 指纹，端口被占用时不会误连
- 下载安全：更新地址仅允许 `https:`，GitHub 资产额外限制域名白名单
- **安装包未签名**：SmartScreen 可能提示「未知发布者」，**不承诺"完全无提示安装"**；签名接入见 [docs/signing.md](docs/signing.md)

### 验收

8 项自动化验收：`powershell -ExecutionPolicy Bypass -File scripts/acceptance.ps1`（详见 [docs/acceptance.md](docs/acceptance.md)）。

### 目录结构

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
