// electron-builder afterPack 钩子
// 用途: electron-builder 的默认过滤规则会排除 node_modules 目录,
//       导致 extraResources 无法把 runtime\node_modules 打进包。
//       这里在打包完成后(签名/安装包生成前)把 dsh 运行时补进 appOutDir。
'use strict'
const fs = require('node:fs')
const path = require('node:path')

exports.default = async function afterPack(context) {
  const src = path.join(__dirname, '..', 'runtime', 'node_modules')
  const dest = path.join(context.appOutDir, 'resources', 'runtime', 'node_modules')

  if (!fs.existsSync(src)) {
    throw new Error(`afterPack: source runtime not found: ${src}`)
  }
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true })
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  console.log(`[afterPack] copying ${src} -> ${dest} ...`)
  copyDirSync(src, dest)
  const size = dirSize(dest)
  console.log(`[afterPack] done, ${(size / 1024 / 1024).toFixed(1)} MB`)
}

function copyDirSync(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(s, d)
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(s)
      try { fs.symlinkSync(target, d) } catch { fs.copyFileSync(s, d) }
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

function dirSize(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(p)
    else if (entry.isFile()) total += fs.statSync(p).size
  }
  return total
}
