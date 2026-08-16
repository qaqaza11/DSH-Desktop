// 诊断窗口预加载: 渲染层保持 sandbox 隔离, 仅暴露"复制到剪贴板 / 关闭窗口"两个动作
'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('diag', {
  copy: () => ipcRenderer.send('diag-copy'),
  close: () => ipcRenderer.send('diag-close'),
})
