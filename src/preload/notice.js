'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  onNotice: (cb) => ipcRenderer.on('notice:data', (_e, d) => cb(d)),
  closeNotice: () => ipcRenderer.invoke('notice:close'),
  openPanel: () => ipcRenderer.invoke('panel:open')
})
