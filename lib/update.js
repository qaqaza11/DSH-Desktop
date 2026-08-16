// 更新检查模块 — 参考 anywhere-labs/deepseek-harness-desktop 的 update-checker
// 设计: 更新源可配置; 未配置时跳过检查。版本比较用严格 SemVer。

'use strict'

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/**
 * 解析严格 SemVer(允许可选的小写 v 前缀)。无效返回 null。
 */
function parseSemVer(input) {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null
  const prerelease = match[4] ? match[4].split('.') : []
  if (prerelease.some((id) => isNumeric(id) && hasLeadingZero(id))) return null
  return { version, major: match[1], minor: match[2], patch: match[3], prerelease }
}

function isNumeric(id) { return /^[0-9]+$/u.test(id) }
function hasLeadingZero(id) { return id.length > 1 && id.startsWith('0') }

function compareNumeric(a, b) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

function compareParsed(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    const c = compareNumeric(left[key], right[key])
    if (c !== 0) return c
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1
  const len = Math.max(left.prerelease.length, right.prerelease.length)
  for (let i = 0; i < len; i += 1) {
    const l = left.prerelease[i]
    const r = right.prerelease[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    const ln = isNumeric(l)
    const rn = isNumeric(r)
    if (ln && rn) return compareNumeric(l, r)
    if (ln) return -1
    if (rn) return 1
    return l < r ? -1 : 1
  }
  return 0
}

/**
 * 比较两个版本字符串(允许 v 前缀)。
 * @returns -1 | 0 | 1, 任一无效时返回 null
 */
function compareVersions(left, right) {
  const a = parseSemVer(String(left))
  const b = parseSemVer(String(right))
  if (a === null || b === null) return null
  return compareParsed(a, b)
}

/**
 * 判断 latest 是否严格新于 current。
 */
function isNewer(latest, current) {
  const c = compareVersions(latest, current)
  return c !== null && c > 0
}

/**
 * 从更新服务响应中提取版本号。
 * 支持两种格式:
 *   { "version": "1.2.3" }                    (version 服务)
 *   { "tag_name": "v1.2.3" }                  (GitHub Releases API)
 * 也支持直接是字符串 "1.2.3"。
 */
function extractVersion(payload) {
  if (typeof payload === 'string') return payload.trim()
  if (payload && typeof payload === 'object') {
    if (typeof payload.version === 'string') return payload.version.trim()
    if (typeof payload.tag_name === 'string') return payload.tag_name.trim()
  }
  return null
}

/**
 * 从 GitHub Releases API 响应中提取资产列表(仅保留安装包选择需要的字段)。
 */
function extractAssets(payload) {
  if (payload && Array.isArray(payload.assets)) {
    return payload.assets
      .map(a => (a && typeof a === 'object')
        ? { name: a.name, browser_download_url: a.browser_download_url }
        : null)
      .filter(Boolean)
  }
  return []
}

/**
 * 解析更新响应并返回 { status, latestVersion, assets, releaseUrl } 或 null(响应不合法时)。
 * releaseUrl 取 GitHub API 响应的 html_url(Release 页面), 供下载后跳转核对校验值。
 */
function parseUpdateResponse(body, currentVersion) {
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  const latestVersion = extractVersion(payload)
  if (latestVersion === null) return null
  if (parseSemVer(latestVersion) === null) return null
  return {
    status: isNewer(latestVersion, currentVersion) ? 'update-available' : 'up-to-date',
    currentVersion,
    latestVersion,
    assets: extractAssets(payload),
    releaseUrl: (payload && typeof payload.html_url === 'string') ? payload.html_url : '',
  }
}

module.exports = {
  compareVersions,
  isNewer,
  extractVersion,
  extractAssets,
  parseUpdateResponse,
}
