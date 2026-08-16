// 更新解析单元测试 — 模拟 GitHub Releases API 与自定义 JSON 端点
import { createRequire } from 'node:module'
import assert from 'node:assert'
const require = createRequire(import.meta.url)
const { parseUpdateResponse, compareVersions, extractVersion, extractAssets } = require('../lib/update.js')

const cur = '0.1.0'
let pass = 0, fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('PASS', name) }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message) }
}

t('自定义 JSON: 新版本 -> update-available', () => {
  const r = parseUpdateResponse(JSON.stringify({ version: '0.2.0' }), cur)
  assert.equal(r.status, 'update-available')
  assert.equal(r.latestVersion, '0.2.0')
  assert.deepEqual(r.assets, [])
  assert.equal(r.releaseUrl, '')
})

t('GitHub API: tag_name v 前缀 + assets 数组 + releaseUrl', () => {
  const payload = JSON.stringify({
    tag_name: 'v0.1.1',
    name: 'v0.1.1',
    html_url: 'https://github.com/qaqaza11/DSH-Desktop/releases/tag/v0.1.1',
    assets: [
      { name: 'DSH Desktop Setup 0.1.1.exe', browser_download_url: 'https://example.com/setup.exe' },
      { name: 'DSH-Desktop-Portable-0.1.1.exe', browser_download_url: 'https://example.com/portable.exe' },
      { name: 'other.txt', browser_download_url: 'https://example.com/other.txt' },
    ],
  })
  const r = parseUpdateResponse(payload, cur)
  assert.equal(r.status, 'update-available')
  assert.equal(r.latestVersion, 'v0.1.1')
  assert.equal(r.assets.length, 3)
  assert.equal(r.assets[0].name, 'DSH Desktop Setup 0.1.1.exe')
  assert.equal(r.releaseUrl, 'https://github.com/qaqaza11/DSH-Desktop/releases/tag/v0.1.1')
})

t('同版本 -> up-to-date', () => {
  const r = parseUpdateResponse(JSON.stringify({ tag_name: 'v0.1.0' }), cur)
  assert.equal(r.status, 'up-to-date')
})

t('低版本 -> up-to-date', () => {
  const r = parseUpdateResponse(JSON.stringify({ version: '0.0.9' }), cur)
  assert.equal(r.status, 'up-to-date')
})

t('非法响应 -> null', () => {
  assert.equal(parseUpdateResponse('not-json', cur), null)
  assert.equal(parseUpdateResponse(JSON.stringify({ foo: 1 }), cur), null)
  assert.equal(parseUpdateResponse(JSON.stringify({ version: 'x.y' }), cur), null)
})

t('semver 预发布比较', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0-rc.6'), 1)
  assert.equal(compareVersions('0.1.0-rc.6', '0.1.0-rc.5'), 1)
  assert.equal(compareVersions('0.1.0-rc.6', '0.1.0-rc.10'), -1)
  assert.equal(compareVersions('v1.0.0', '0.9.9'), 1)
  assert.equal(compareVersions('bad', '0.1.0'), null)
})

t('extractVersion 兼容字符串响应', () => {
  assert.equal(extractVersion('0.1.2'), '0.1.2')
  assert.equal(extractVersion({ version: '1.0.0' }), '1.0.0')
  assert.equal(extractVersion({ tag_name: 'v2.0.0' }), 'v2.0.0')
  assert.equal(extractVersion({}), null)
})

t('extractAssets 提取 GitHub 资产', () => {
  const a = extractAssets({ assets: [{ name: 'a.exe', browser_download_url: 'https://x/a.exe' }] })
  assert.equal(a.length, 1)
  assert.equal(a[0].name, 'a.exe')
  assert.equal(extractAssets({}).length, 0)
  assert.equal(extractAssets({ assets: 'nope' }).length, 0)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
