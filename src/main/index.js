'use strict'

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron')
const path = require('node:path')
const zlib = require('node:zlib')
const { Store } = require('./store')
const { Tracker } = require('./tracker')

const FLOAT_BASE_W = 224
const FLOAT_BASE_H = 40
const PANEL_W = 640
const PANEL_H = 760
const NOTICE_W = 340
const NOTICE_H = 226

/** 浮窗尺寸随字号缩放，保持内容不溢出 */
function floatSize(fontScale) {
  const s = Math.max(0.85, Math.min(1.2, Number(fontScale) || 1))
  return { width: Math.round(FLOAT_BASE_W * s), height: Math.round(FLOAT_BASE_H * s) }
}

let store = null
let tracker = null
let floatWin = null
let panelWin = null
let noticeWin = null
let tray = null
let noticeShownAt = 0
let noticeAutoClose = false
let quitting = false

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const bootLog = process.env.TT_DEBUG ? path.join(require('node:os').tmpdir(), 'tt-boot.log') : null
function log(...args) {
  if (!bootLog) return
  try {
    require('node:fs').appendFileSync(bootLog, `[${new Date().toISOString()}] ${args.join(' ')}\n`)
  } catch {
    /* 日志失败不影响启动 */
  }
}
log('module loaded, argv=', process.argv.join(' '), 'isPackaged=', app.isPackaged)

/* ---------- 运行时生成图标，避免依赖外部图片 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** 蓝色圆盘 + 白色缺口，做成一个朴素的计时盘图标 */
function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.45
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const t = Math.max(0, Math.min(1, r + 1 - d))
      px[i] = 0x37
      px[i + 1] = 0x8a
      px[i + 2] = 0xdd
      px[i + 3] = Math.round(255 * t)
      if (d < r * 0.62 && d > r * 0.42) {
        px[i] = 0xff
        px[i + 1] = 0xff
        px[i + 2] = 0xff
      }
    }
  }
  return nativeImage.createFromBuffer(encodePNG(size, size, px))
}

/* ---------- 窗口 ---------- */
function preloadPath(name) {
  return path.join(__dirname, '..', 'preload', `${name}.js`)
}

function rendererPath(...parts) {
  return path.join(__dirname, '..', 'renderer', ...parts)
}

function createFloat() {
  const area = screen.getPrimaryDisplay().workArea
  const saved = store.settings.floatPos
  const size = floatSize(store.settings.fontScale)
  const x = saved ? saved[0] : area.x + area.width - size.width - 24
  const y = saved ? saved[1] : area.y + 24

  floatWin = new BrowserWindow({
    width: size.width,
    height: size.height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: preloadPath('float'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  floatWin.setAlwaysOnTop(true, 'floating')
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  floatWin.loadFile(rendererPath('float', 'index.html'))
  floatWin.once('ready-to-show', () => floatWin.showInactive())
  floatWin.on('moved', () => {
    if (!floatWin || floatWin.isDestroyed()) return
    const [px, py] = floatWin.getPosition()
    store.setSettings({ floatPos: [px, py] })
    store.save()
  })
  floatWin.on('closed', () => { floatWin = null })
}

function applyFloatScale(fontScale) {
  if (!floatWin || floatWin.isDestroyed()) return
  const b = floatWin.getBounds()
  const size = floatSize(fontScale)
  if (b.width === size.width && b.height === size.height) return
  floatWin.setBounds({ x: b.x, y: b.y, width: size.width, height: size.height })
}

function createPanel() {
  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    frame: false,
    resizable: false,
    maximizable: false,
    show: false,
    skipTaskbar: false,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: preloadPath('panel'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  panelWin.loadFile(rendererPath('panel', 'index.html'))
  panelWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      panelWin.hide()
    }
  })
  panelWin.on('closed', () => { panelWin = null })
}

function showPanel() {
  if (!panelWin || panelWin.isDestroyed()) createPanel()
  const anchor = floatWin && !floatWin.isDestroyed() ? floatWin.getBounds() : null
  const display = anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()
  const area = display.workArea
  const x = Math.round(area.x + (area.width - PANEL_W) / 2)
  const y = Math.round(area.y + (area.height - PANEL_H) / 2)
  panelWin.setPosition(x, y)
  panelWin.show()
  panelWin.focus()
}

function hidePanel() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.hide()
}

function createNotice(payload) {
  if (noticeWin && !noticeWin.isDestroyed()) noticeWin.destroy()
  noticeAutoClose = payload.reason === 'idle'
  noticeWin = new BrowserWindow({
    width: NOTICE_W,
    height: NOTICE_H,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: {
      preload: preloadPath('notice'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  const area = screen.getPrimaryDisplay().workArea
  noticeWin.setPosition(Math.round(area.x + (area.width - NOTICE_W) / 2), Math.round(area.y + area.height * 0.28))
  noticeWin.loadFile(rendererPath('notice', 'index.html'))
  noticeWin.once('ready-to-show', () => {
    noticeWin.show()
    noticeWin.setAlwaysOnTop(true, 'screen-saver')
    noticeShownAt = Date.now()
    noticeWin.webContents.send('notice:data', payload)
  })
  noticeWin.on('closed', () => {
    noticeWin = null
    noticeShownAt = 0
    noticeAutoClose = false
  })
}

function closeNotice() {
  if (noticeWin && !noticeWin.isDestroyed()) noticeWin.destroy()
  noticeWin = null
  noticeShownAt = 0
  noticeAutoClose = false
}

/* ---------- 托盘 ---------- */
function buildTray() {
  const icon = makeIcon(32).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('每日学习计时器')
  refreshTray()
  tray.on('click', () => showPanel())
}

function refreshTray() {
  if (!tray) return
  const running = tracker && tracker.session
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: running ? '学习中' : '未开始', enabled: false },
    { type: 'separator' },
    { label: '显示面板', click: () => showPanel() },
    { label: running ? '停止本次' : '开始学习', click: () => {
      if (running) tracker.stop('manual')
      else showPanel()
    } },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!store.settings.autoLaunch,
      click: (item) => applyAutoLaunch(item.checked)
    },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  ]))
}

function applyAutoLaunch(enabled) {
  store.setSettings({ autoLaunch: enabled })
  store.save()
  app.setLoginItemSettings({ openAtLogin: enabled })
  broadcastState()
}

/* ---------- 状态广播 ---------- */
function broadcastState() {
  const snap = tracker ? tracker.snapshot() : null
  if (!snap) return
  snap.settings = store.settings
  for (const win of [floatWin, panelWin]) {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('state', snap)
    }
  }
}

/* ---------- IPC ---------- */
function registerIpc() {
  ipcMain.handle('state:get', () => {
    const snap = tracker.snapshot()
    snap.settings = store.settings
    return snap
  })

  ipcMain.handle('session:start', (_e, targetMin) => {
    const res = tracker.begin(targetMin)
    broadcastState()
    return res
  })

  ipcMain.handle('session:stop', () => {
    const rec = tracker.stop('manual')
    broadcastState()
    return rec ? { ok: true } : { ok: false }
  })

  ipcMain.handle('panel:open', () => { showPanel(); return true })
  ipcMain.handle('panel:hide', () => { hidePanel(); return true })
  ipcMain.handle('notice:close', () => { closeNotice(); return true })

  ipcMain.on('float:move', (_e, x, y) => {
    if (floatWin && !floatWin.isDestroyed()) floatWin.setPosition(Math.round(x), Math.round(y))
  })

  ipcMain.handle('records:list', () => store.records.slice().sort((a, b) => b.endTs - a.endTs))

  ipcMain.handle('record:setStatus', (_e, id, status) => {
    const rec = store.updateRecord(id, { status })
    store.save()
    broadcastState()
    return !!rec
  })

  ipcMain.handle('record:remove', (_e, id) => {
    const ok = store.removeRecord(id)
    store.save()
    broadcastState()
    return ok
  })

  ipcMain.handle('manual:add', (_e, payload) => {
    const { startTs, endTs, note } = payload
    if (!(endTs > startTs)) return { ok: false, error: 'range' }
    const seconds = Math.round((endTs - startTs) / 1000)
    if (seconds < 60) return { ok: false, error: 'tooShort' }
    const rec = {
      id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      startTs,
      endTs,
      dayStartTs: new Date(startTs).setHours(0, 0, 0, 0),
      seconds,
      segments: [[startTs, endTs]],
      targetSec: 0,
      source: 'manual',
      status: 'active',
      endReason: 'manual',
      note: note || ''
    }
    store.addRecord(rec)
    store.save()
    broadcastState()
    return { ok: true, record: rec }
  })

  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return store.settings
    const prevFs = store.settings.fontScale
    if (typeof patch.autoLaunch === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: patch.autoLaunch })
    }
    store.setSettings(patch)
    store.save()
    if (patch.fontScale != null && patch.fontScale !== prevFs) applyFloatScale(patch.fontScale)
    broadcastState()
    return store.settings
  })
}

/* ---------- 旧版本数据迁移 ---------- */
function migrateLegacyData() {
  try {
    const fs = require('node:fs')
    const target = path.join(app.getPath('userData'), 'data.json')
    const legacy = path.join(app.getPath('appData'), '时间管理', 'data.json')
    if (fs.existsSync(target) || !fs.existsSync(legacy)) return
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(legacy, target)
    log('migrated legacy data from', legacy)
  } catch (err) {
    log('migrate failed', err.message)
  }
}

/* ---------- 启动 ---------- */
const gotLock = app.requestSingleInstanceLock()
log('singleInstanceLock =', gotLock)
if (!gotLock) {
  log('quit: another instance holds the lock')
  app.quit()
} else {
  app.on('second-instance', () => showPanel())

  app.whenReady().then(() => {
    log('app ready')
    app.setAppUserModelId('cn.u32.daily-study-timer')
    migrateLegacyData()
    store = new Store(app.getPath('userData'))
    if (process.env.TT_THEME) store.setSettings({ theme: process.env.TT_THEME })
    if (process.env.TT_FS) store.setSettings({ fontScale: Number(process.env.TT_FS) })
    log('store at', store.file)
    tracker = new Tracker(store)

    registerIpc()
    log('ipc registered')
    createFloat()
    log('float created')
    createPanel()
    log('panel created')
    buildTray()
    log('tray created')

    tracker.on('tick', () => {
      broadcastState()
      if (noticeWin && noticeAutoClose && noticeShownAt && Date.now() - noticeShownAt > 900) {
        if (tracker.systemIdleMs < 800) closeNotice()
      }
    })

    tracker.on('ended', ({ record, reason }) => {
      refreshTray()
      if (reason === 'lock' || reason === 'sleep' || reason === 'crash') {
        broadcastState()
        return
      }
      createNotice({ record, reason, snap: tracker.snapshot(), sound: store.settings.sound })
    })

    tracker.start()
    app.setLoginItemSettings({ openAtLogin: !!store.settings.autoLaunch })
    refreshTray()

    if (process.env.TT_SHOT) {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      setTimeout(async () => {
        const fs = require('node:fs')
        const base = process.env.TT_SHOT.replace(/\.png$/, '')
        try {
          fs.writeFileSync(`${base}-float.png`, (await floatWin.capturePage()).toPNG())
          showPanel()
          await sleep(900)
          fs.writeFileSync(`${base}-panel.png`, (await panelWin.capturePage()).toPNG())
          if (process.env.TT_NOTICE) {
            createNotice({
              record: { seconds: 2400, startTs: Date.now() - 2400000, endTs: Date.now() },
              reason: 'idle',
              snap: tracker.snapshot(),
              sound: false
            })
            await sleep(1400)
            fs.writeFileSync(`${base}-notice.png`, (await noticeWin.capturePage()).toPNG())
            closeNotice()
          }
          if (process.env.TT_DEMO) {
            await panelWin.webContents.executeJavaScript("document.getElementById('mainBtn').click()")
            await sleep(3200)
            console.log('[shot] running =', !!tracker.session)
            fs.writeFileSync(`${base}-run-float.png`, (await floatWin.capturePage()).toPNG())
            fs.writeFileSync(`${base}-run-panel.png`, (await panelWin.capturePage()).toPNG())
            if (process.env.TT_SETTINGS) {
              await panelWin.webContents.executeJavaScript("document.getElementById('settingsBtn').click()")
              await sleep(700)
              fs.writeFileSync(`${base}-settings.png`, (await panelWin.capturePage()).toPNG())
              await panelWin.webContents.executeJavaScript("document.getElementById('settingsClose').click()")
              await sleep(300)
            }
            await panelWin.webContents.executeJavaScript("document.getElementById('mainBtn').click()")
            await sleep(1200)
            console.log('[shot] after stop =', !!tracker.session, 'records =', store.records.length)
            fs.writeFileSync(`${base}-stop-panel.png`, (await panelWin.capturePage()).toPNG())
          }
          console.log('[shot] saved')
        } catch (err) {
          console.error('[shot]', err.message)
        }
      }, 2000)
    }
  })

  app.on('window-all-closed', () => {})
  app.on('before-quit', () => { quitting = true })
}
