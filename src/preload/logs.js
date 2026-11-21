'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  records: () => ipcRenderer.invoke('records:list'),
  setStatus: (id, status) => ipcRenderer.invoke('record:setStatus', id, status),
  removeRecord: (id) => ipcRenderer.invoke('record:remove', id),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  hideLogs: () => ipcRenderer.invoke('logs:hide'),
  onLogsRefresh: (cb) => ipcRenderer.on('logs:refresh', () => cb())
})
