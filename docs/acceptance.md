# 发布验收清单(最小集)

每次发版前, 在"干净用户环境"下执行。干净环境定义:

- 全新 `DSH_HOME` 临时目录(模拟从未装过 dsh 的用户)
- 全新 Electron `--user-data-dir`(无历史配置/会话/日志)
- 独立端口(避开本机常驻的 3080 DSH)

自动化脚本: `powershell -ExecutionPolicy Bypass -File scripts/acceptance.ps1`(默认验收 `%LOCALAPPDATA%\Programs\DSH Desktop\DSH Desktop.exe`, 可 `-AppExe` 指定)。
运行前先静默安装最新安装包: `dist\DSH Desktop Setup x.y.z.exe /S`。

## 自动化项(脚本判定 PASS/FAIL)

| # | 验收项 | 判定标准 |
|---|---|---|
| A | 首次启动 | 窗口标题为 `DSH Desktop`; 独立端口 100 秒内返回 HTTP 200 且 HTML 含 DSH 指纹 `__DSH_BOOT__`(全新 DSH_HOME 下 dsh 会自动初始化 web profile) |
| B | 关闭到托盘 | 给主窗口发 WM_CLOSE 后: 窗口隐藏(句柄/标题为空)、进程仍存活、DSH 服务仍可访问 |
| C | 退出清理 | 应用内置测试钩子 `DSH_DESKTOP_TEST_QUIT_MS` 到期后走真实 `quitApp() -> killChildTree` 路径: 应用进程退出, 且不再有指向 `resources\runtime` 的 DSH 子进程残留 |
| D | 端口冲突 | 用非 DSH 的 HTTP 服务占住端口后启动: 弹出「无法启动 dsh 服务」诊断窗口, 不会误连该端口 |
| E | 断网检查更新 | 更新源指向不可达地址(127.0.0.1:9): 静默失败并把「检查更新失败」写入日志, 应用不崩溃 |
| F | 升级提示 | 本地 mock 返回更高版本(`{"version":"9.9.9"}`): 日志出现「发现新版本: 9.9.9」, 弹升级确认框 |
| G | 自动端口 | 未设置 `DSH_DESKTOP_PORT` 时: 日志出现「已就绪: http://127.0.0.1:<端口>」, 该端口返回 DSH 指纹, 且不是 3080(独立实例, 不与浏览器端冲突) |
| H | 工作目录 | 设置 `DSH_DESKTOP_WORKDIR` 后: 启动日志记录该目录(实际传给 spawn 的 cwd), dsh 会话目录按该 cwd 编码生成 |

## 人工项(脚本无法点击原生控件)

1. 托盘图标右键菜单: 「打开 DSH Desktop」能恢复窗口; 「检查更新」在未配置更新源时提示配置方式
2. 升级确认框: 「下载」后安装包落入 `下载\DSH-Desktop-Updates\`, 弹窗展示 SHA-256 且不自动执行
3. 诊断窗口: 「复制诊断信息」「打开日志」「重试启动」按钮可用(重试在端口恢复后可自愈)
4. 卸载: 控制面板或 `Uninstall DSH Desktop.exe` 卸载后, 安装目录被清除
5. 安装包签名核验: `(Get-AuthenticodeSignature 'dist\DSH Desktop Setup x.y.z.exe').Status` —— 未签名阶段预期 `NotSigned`(此时必须在 README/Release 如实标注 SmartScreen 可能提示); 签名接入后预期 `Valid` 且签名者主题正确
6. Release 校验文件: 上传的 `SHA256SUMS.txt`(由 `scripts/make-sha256sums.ps1` 生成)必须与上传的安装包实际 SHA-256 一致(用户比对哈希的可信依据)

## 备注

- 验收脚本依赖本机 node(本地 mock 服务); 退出依赖应用内的 `DSH_DESKTOP_TEST_QUIT_MS` 测试钩子(仅环境变量显式设置时生效, 正常使用零影响)
- 脚本不修改被验收应用与系统状态; 临时目录都在 `%TEMP%\dsd-accept-*`
- 若要验收真实"首次装机"路径(全新 Windows 账号), 请另建本地账号复跑 A/B/C 三项
