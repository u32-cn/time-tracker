'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  start: (min) => ipcRenderer.invoke('session:start', min),
  quickStart: () => ipcRenderer.invoke('session:quick-start'),
  stop: () => ipcRenderer.invoke('session:stop'),
  openPanel: () => ipcRenderer.invoke('panel:open'),
  hidePanel: () => ipcRenderer.invoke('panel:hide'),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  move: (x, y) => ipcRenderer.send('float:move', x, y),
  records: () => ipcRenderer.invoke('records:list'),
  setStatus: (id, status) => ipcRenderer.invoke('record:setStatus', id, status),
  removeRecord: (id) => ipcRenderer.invoke('record:remove', id),
  addManual: (payload) => ipcRenderer.invoke('manual:add', payload),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch)
})
