// 诊断窗口预加载: 渲染层保持 sandbox 隔离, 仅暴露少量动作(复制/关闭/重试/打开日志)
'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('diag', {
  copy: () => ipcRenderer.send('diag-copy'),
  close: () => ipcRenderer.send('diag-close'),
  retry: () => ipcRenderer.send('diag-retry'),
  openLog: () => ipcRenderer.send('diag-open-log'),
})
