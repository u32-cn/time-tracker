'use strict'

const $ = (id) => document.getElementById(id)

const el = {
  stateChip: $('stateChip'),
  todayValue: $('todayValue'),
  todaySub: $('todaySub'),
  restNum: $('restNum'),
  restFill: $('restFill'),
  restHint: $('restHint'),
  minutesBox: $('minutesBox'),
  minutesInput: $('minutesInput'),
  mainBtn: $('mainBtn'),
  manualBtn: $('manualBtn'),
  manualForm: $('manualForm'),
  manualStart: $('manualStart'),
  manualEnd: $('manualEnd'),
  manualNote: $('manualNote'),
  manualMsg: $('manualMsg'),
  manualSave: $('manualSave'),
  manualCancel: $('manualCancel'),
  timeline: $('timeline'),
  week: $('week'),
  weekSub: $('weekSub'),
  logsBtn: $('logsBtn'),
  logsLink: $('logsLink'),
  settingsBtn: $('settingsBtn'),
  settingsSheet: $('settingsSheet'),
  settingsClose: $('settingsClose'),
  setAutoLaunch: $('setAutoLaunch'),
  setSound: $('setSound'),
  themeSeg: $('themeSeg'),
  fsRange: $('fsRange'),
  fsValue: $('fsValue'),
  closeBtn: $('closeBtn')
}

let state = null
let records = []
let lastSessionId = null
let lastSettingsKey = ''

const DAY_MS = 86400000

function pad(n) {
  return String(n).padStart(2, '0')
}

function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${pad(m)}:${pad(s)}`
}

function fmtMinSec(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${pad(s)}`
}

function fmtDur(ms) {
  const min = Math.round(ms / 60000)
  if (min < 1) return '不足 1 分钟'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} 分钟`
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

function hm(ts) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function dayStartOf(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function segsOf(rec) {
  if (Array.isArray(rec.segments) && rec.segments.length) return rec.segments
  return [[rec.startTs, rec.endTs]]
}

function overlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
}

/* ---------- 设置应用 ---------- */
function applySettings(s) {
  if (!s) return
  const theme = s.theme === 'dark' ? 'dark' : 'light'
  const fs = Math.max(0.85, Math.min(1.2, Number(s.fontScale) || 1))
  const key = `${theme}|${fs}|${!!s.autoLaunch}|${s.sound !== false}`
  if (key === lastSettingsKey) return
  lastSettingsKey = key

  document.documentElement.dataset.theme = theme
  document.documentElement.style.setProperty('--fs', fs)
  el.fsValue.textContent = Math.round(fs * 100) + '%'
  el.fsRange.value = String(Math.round(fs * 100))
  el.setAutoLaunch.checked = !!s.autoLaunch
  el.setSound.checked = s.sound !== false
  for (const btn of el.themeSeg.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', btn.dataset.themeValue === theme)
  }
}

/* ---------- 状态渲染 ---------- */
function renderState() {
  if (!state) return
  applySettings(state.settings)
  const now = Date.now()
  const sessionChanged = state.sessionId !== lastSessionId

  el.todayValue.textContent = fmtClock(state.todayMs)

  const todayActive = records.filter((r) => r.status === 'active' && r.dayStartTs === dayStartOf(now)).length
  if (state.running) {
    el.todaySub.textContent = `共 ${todayActive} 段 · 本次 ${fmtMinSec(state.elapsedMs)}`
  } else {
    el.todaySub.textContent = todayActive === 0 ? '还没有记录' : `共 ${todayActive} 段`
  }

  /* 状态标签 */
  if (state.running) {
    const idleWarn = state.idleMs >= 60000
    el.stateChip.textContent = idleWarn ? `无操作 ${Math.floor(state.idleMs / 1000)} 秒` : '计时中'
    el.stateChip.className = 'chip ' + (idleWarn ? 'warn' : 'running')
  } else if (!state.canStart) {
    el.stateChip.textContent = '需休息'
    el.stateChip.className = 'chip warn'
  } else {
    el.stateChip.textContent = '未开始'
    el.stateChip.className = 'chip'
  }

  /* 休息进度 */
  const restMs = state.restMs
  const restShown = Math.min(restMs, 300000)
  el.restFill.style.width = Math.min(100, (restMs / 300000) * 100) + '%'
  el.restFill.className = 'rest-fill' + (restMs < 300000 ? ' low' : '')
  el.restNum.textContent = `${fmtMinSec(restShown)} / 5:00`

  if (restMs >= 300000) {
    el.restHint.textContent = '休息已达标，可以放心学'
    el.restHint.className = 'rest-hint'
  } else if (!state.canStart) {
    el.restHint.textContent = `还需休息 ${fmtMinSec(state.restWaitMs)} 才能开始`
    el.restHint.className = 'rest-hint warn'
  } else {
    el.restHint.textContent = `还能学 ${fmtDur(state.maxStudyMs)}，之后必须休息`
    el.restHint.className = 'rest-hint warn'
  }

  /* 主按钮 */
  if (state.running) {
    el.mainBtn.textContent = `停止（剩 ${fmtMinSec(state.remainingMs)}）`
    el.mainBtn.className = 'btn-primary stop'
    el.mainBtn.disabled = false
    el.minutesBox.classList.add('disabled')
  } else {
    el.mainBtn.className = 'btn-primary'
    el.minutesBox.classList.remove('disabled')
    if (state.canStart) {
      el.mainBtn.textContent = '开始学习'
      el.mainBtn.disabled = false
    } else {
      el.mainBtn.textContent = `还需休息 ${fmtMinSec(state.restWaitMs)}`
      el.mainBtn.disabled = true
    }
  }

  if (sessionChanged) {
    lastSessionId = state.sessionId
    loadRecords()
  }

  if (state.running) renderTimeline()
}

/* ---------- 时间轴 ---------- */
function renderTimeline() {
  if (!state) return
  const now = Date.now()
  const dayStart = dayStartOf(now)
  const dayEnd = dayStart + DAY_MS

  el.timeline.innerHTML = ''

  const segs = []
  for (const rec of records) {
    if (rec.dayStartTs !== dayStart) continue
    for (const [a, b] of segsOf(rec)) {
      segs.push({ a: Math.max(a, dayStart), b: Math.min(b, dayEnd), void: rec.status === 'void' })
    }
  }
  for (const [a, b] of state.segments || []) {
    segs.push({ a: Math.max(a, dayStart), b: Math.min(b, dayEnd), void: false })
  }

  const visible = segs.filter((s) => s.b > s.a)
  if (visible.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'tl-empty'
    empty.dataset.u32Name = 'timeline-empty'
    empty.textContent = '今天还没有学习时段'
    el.timeline.appendChild(empty)
    return
  }

  for (const s of visible) {
    const block = document.createElement('div')
    block.className = 'tl-block' + (s.void ? ' void' : '')
    block.dataset.u32Name = 'timeline-block'
    block.style.left = ((s.a - dayStart) / DAY_MS) * 100 + '%'
    block.style.width = Math.max(0.12, ((s.b - s.a) / DAY_MS) * 100) + '%'
    block.title = `${hm(s.a)} - ${hm(s.b)} · ${fmtDur(s.b - s.a)}`
    el.timeline.appendChild(block)
  }
}

/* ---------- 7 天 ---------- */
function renderWeek() {
  const now = Date.now()
  const todayStart = dayStartOf(now)
  const wd = ['日', '一', '二', '三', '四', '五', '六']
  const stats = []

  for (let i = 6; i >= 0; i--) {
    const ds = todayStart - i * DAY_MS
    const de = ds + DAY_MS
    let ms = 0
    for (const rec of records) {
      if (rec.status !== 'active') continue
      for (const [a, b] of segsOf(rec)) ms += overlap(a, b, ds, de)
    }
    stats.push({ ds, ms, label: i === 0 ? '今天' : i === 1 ? '昨天' : `周${wd[new Date(ds).getDay()]}`, today: i === 0 })
  }

  const max = Math.max(1, ...stats.map((s) => s.ms))
  el.week.innerHTML = ''
  for (const s of stats) {
    const col = document.createElement('div')
    col.className = 'week-col'
    col.dataset.u32Name = 'week-col'

    const bar = document.createElement('div')
    bar.className = 'week-bar' + (s.ms === 0 ? ' zero' : s.today ? ' today' : '')
    bar.dataset.u32Name = 'week-bar'
    bar.style.height = (s.ms === 0 ? 6 : Math.max(8, Math.round((s.ms / max) * 44))) + 'px'
    bar.title = `${s.label} ${fmtDur(s.ms)}`

    const label = document.createElement('span')
    label.className = 'week-label' + (s.today ? ' today' : '')
    label.dataset.u32Name = 'week-label'
    label.textContent = s.label

    col.appendChild(bar)
    col.appendChild(label)
    el.week.appendChild(col)
  }

  const total = stats.reduce((sum, s) => sum + s.ms, 0)
  el.weekSub.textContent = total > 0 ? `合计 ${fmtDur(total)}` : ''
}

async function loadRecords() {
  records = await window.api.records()
  renderTimeline()
  renderWeek()
  if (state) renderState()
}

/* ---------- 交互 ---------- */
el.mainBtn.addEventListener('click', async () => {
  if (!state) return
  if (state.running) {
    await window.api.stop()
    return
  }
  const min = parseInt(el.minutesInput.value, 10)
  if (!min || min < 1 || min > 40) {
    el.manualMsg.textContent = '时长需在 1 - 40 分钟之间'
    return
  }
  const res = await window.api.start(min)
  if (!res.ok) {
    el.mainBtn.textContent = '还需休息'
    el.mainBtn.disabled = true
  }
})

el.manualBtn.addEventListener('click', () => {
  const showing = !el.manualForm.hidden
  el.manualForm.hidden = showing
  if (!showing) {
    const now = new Date()
    el.manualEnd.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`
    const start = new Date(now.getTime() - 30 * 60000)
    el.manualStart.value = `${pad(start.getHours())}:${pad(start.getMinutes())}`
    el.manualMsg.textContent = ''
  }
})

el.manualCancel.addEventListener('click', () => {
  el.manualForm.hidden = true
})

el.manualSave.addEventListener('click', async () => {
  const s = el.manualStart.value
  const e = el.manualEnd.value
  if (!s || !e) {
    el.manualMsg.textContent = '请填写开始和结束时间'
    el.manualMsg.className = 'form-msg err'
    return
  }
  const base = dayStartOf(Date.now())
  const [sh, sm] = s.split(':').map(Number)
  const [eh, em] = e.split(':').map(Number)
  let startTs = base + sh * 3600000 + sm * 60000
  let endTs = base + eh * 3600000 + em * 60000
  if (endTs <= startTs) endTs += DAY_MS

  const res = await window.api.addManual({ startTs, endTs, note: el.manualNote.value.trim() })
  if (!res.ok) {
    el.manualMsg.textContent = res.error === 'tooShort' ? '至少 1 分钟' : '时间不合法'
    el.manualMsg.className = 'form-msg err'
    return
  }
  el.manualMsg.textContent = `已补记 ${fmtDur(endTs - startTs)}`
  el.manualMsg.className = 'form-msg ok'
  el.manualNote.value = ''
  await loadRecords()
  setTimeout(() => { el.manualForm.hidden = true }, 1200)
})

el.settingsBtn.addEventListener('click', () => {
  lastSettingsKey = ''
  if (state) applySettings(state.settings)
  el.settingsSheet.hidden = false
})

el.themeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn')
  if (!btn) return
  window.api.setSettings({ theme: btn.dataset.themeValue })
})

el.fsRange.addEventListener('input', () => {
  const v = Number(el.fsRange.value) / 100
  document.documentElement.style.setProperty('--fs', v)
  el.fsValue.textContent = el.fsRange.value + '%'
})

el.fsRange.addEventListener('change', () => {
  window.api.setSettings({ fontScale: Number(el.fsRange.value) / 100 })
})

el.settingsClose.addEventListener('click', () => { el.settingsSheet.hidden = true })
el.settingsSheet.addEventListener('click', (e) => {
  if (e.target === el.settingsSheet) el.settingsSheet.hidden = true
})

el.setAutoLaunch.addEventListener('change', () => {
  window.api.setSettings({ autoLaunch: el.setAutoLaunch.checked })
})

el.setSound.addEventListener('change', () => {
  window.api.setSettings({ sound: el.setSound.checked })
})

el.logsBtn.addEventListener('click', () => window.api.openLogs())
el.logsLink.addEventListener('click', () => window.api.openLogs())

el.closeBtn.addEventListener('click', () => window.api.hidePanel())

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!el.settingsSheet.hidden) el.settingsSheet.hidden = true
    else if (!el.manualForm.hidden) el.manualForm.hidden = true
    else window.api.hidePanel()
  }
})

/* ---------- 启动 ---------- */
window.api.onState((s) => { state = s; renderState() })
window.api.getState().then((s) => { state = s; renderState(); loadRecords() })

setInterval(() => { if (!state || !state.running) loadRecords() }, 60000)
