# Windows 代码签名接入指南

> 诚实前提: **签名解决"发布者身份 + 防篡改", 但不承诺立刻零提示**。
> SmartScreen 的信誉需要时间与下载量积累, 新证书初期仍可能出现提示;
> 未签名阶段请如实告知用户可能出现警告, 不要宣传"完全无提示安装"。

## 一、申请证书的两种途径

### A. Azure Trusted Signing(推荐, 个人开发者最可行)

微软托管的代码签名服务, 无本地硬件/USB Key, 与 electron-builder 26 原生集成。

- 前提: 一个 Azure 订阅(个人可开), 完成微软要求的身份验证
- 流程: Azure 门户 → 创建 "Trusted Signing Account" → 建 "Certificate Profile"(Public Trust 用于公开发行) → 记下 `codeSigningAccountName` / `certificateProfileName` / `endpoint` / `subscriptionId` / `resourceGroupName`
- 认证: 用 Entra ID 应用注册获得 `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`(给该应用授予签名角色)
- 费用: 按微软当前定价为准(基础 SKU 月费很低)

参考: [electron-builder 官方文档](https://builder.electron.js.cn/code-signing-win#using-azure-trusted-signing-beta)

### B. 商业代码签名证书(传统 OV)

DigiCert / Sectigo / Certum 等 CA 出售; 组织主体可申请 OV 证书, 个人开发者可找支持"个人 OV 代码签名"的供应商(如 Certum 的低价档, 约 €50-70/年, 以官方报价为准)。

- 交付形式: PFX 文件(密码保护)或 USB Token
- OV 证书签发前 CA 会做身份核验, 需要提前准备身份材料

## 二、electron-builder 接入(打包管线已就绪, 无需改代码)

### 方式 1: PFX 证书(本地/CI 通用)

打包前设置两个环境变量, `npm run dist` 会自动对主程序、安装包、卸载器签名:

```powershell
$env:CSC_LINK = 'D:\certs\dsh-desktop.pfx'   # 本地路径或 URL
$env:CSC_KEY_PASSWORD = '证书密码'
npm run dist
```

### 方式 2: Azure Trusted Signing

拿到真实参数后, 在 `package.json` 的 `build.win` 里加上:

```json
"azureSignOptions": {
  "certificateProfileName": "your-profile",
  "codeSigningAccountName": "your-account",
  "endpoint": "https://your-account.codesigning.azure.net",
  "subscriptionId": "your-subscription-id",
  "resourceGroupName": "your-rg"
}
```

配合环境变量 `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`。

⚠️ **不要**提前把占位值写进 package.json —— 有配置但缺凭据时打包会直接失败。
拿到真实值之前保持现状(未签名)即可, 打包管线兼容两种方式。

### GitHub Actions 提示

证书用仓库 Secrets 保存(`CSC_LINK` 内容可以是 base64 的 pfx、`CSC_KEY_PASSWORD` 密码, 或 `AZURE_*` 四个 secret), 打包步骤前注入环境变量即可, 与本地打包行为一致。

## 三、验证与发布

1. 验证签名: `(Get-AuthenticodeSignature .\dist\DSH Desktop Setup x.y.z.exe).Status` 应为 `Valid`, 并检查签名者主题
2. 上传 Release: 用签名后的 exe 作为资产(自动更新下载的就是它)
3. 客户端侧: 目前更新流程"下载后展示 SHA-256 供人工核对", 签名就绪后可以在此环节增加 `Get-AuthenticodeSignature` 校验, 通过后再放开自动安装(见 main.js `downloadUpdateInstaller` 的 TODO 语义)

## 四、未签名阶段的如实话术(README/Release 注明)

- "安装包未签名, Windows SmartScreen 可能提示'未知发布者', 请选择'仍要运行'"
- "请从 GitHub Releases 官方渠道下载, 并用页面公布的 SHA-256 核对完整性"
- 不要在未签名阶段承诺"完全无提示安装"
