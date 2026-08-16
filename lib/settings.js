// 轻量设置持久化: userData/settings.json
// 目前字段: { workDir: string|null } — 「打开项目…」选择并记住的工作目录
'use strict'
const fs = require('node:fs')
const path = require('node:path')

function settingsFile(userDataDir) {
  return path.join(userDataDir, 'settings.json')
}

function loadSettings(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(userDataDir), 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(userDataDir, settings) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(settingsFile(userDataDir), JSON.stringify(settings, null, 2), 'utf8')
    return true
  } catch (e) {
    console.error('保存设置失败:', e.message)
    return false
  }
}

module.exports = { loadSettings, saveSettings }
