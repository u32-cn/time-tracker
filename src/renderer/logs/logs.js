'use strict'

const $ = (id) => document.getElementById(id)

const el = {
  summaryMain: $('summaryMain'),
  summarySub: $('summarySub'),
  list: $('list'),
  closeBtn: $('closeBtn')
}

const REASON_TEXT = {
  target: '时间到',
  rest: '休息不足',
  idle: '无操作',
  lock: '锁屏',
  sleep: '睡眠',
  manual: '手动停止',
  crash: '异常退出'
}
const REASON_WARN = new Set(['rest', 'idle', 'lock', 'sleep', 'crash'])

let records = []
let lastSettingsKey = ''

function pad(n) {
  return String(n).padStart(2, '0')
}

function hm(ts) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDur(ms) {
  const min = Math.round(ms / 60000)
  if (min < 1) return '不足 1 分钟'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} 分钟`
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

function dayStartOf(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayLabel(dayTs) {
  const today = dayStartOf(Date.now())
  if (dayTs === today) return '今天'
  if (dayTs === today - 86400000) return '昨天'
  const d = new Date(dayTs)
  const wd = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${wd[d.getDay()]}`
}

function applySettings(s) {
  if (!s) return
  const theme = s.theme === 'dark' ? 'dark' : 'light'
  const fs = Math.max(0.8, Math.min(1.6, Number(s.fontScale) || 1.2))
  const key = `${theme}|${fs}`
  if (key === lastSettingsKey) return
  lastSettingsKey = key
  document.documentElement.dataset.theme = theme
  document.documentElement.style.setProperty('--fs', fs)
}

function render() {
  el.list.innerHTML = ''

  const today = dayStartOf(Date.now())
  const todayRecs = records.filter((r) => r.dayStartTs === today && r.status === 'active')
  const todayMs = todayRecs.reduce((sum, r) => sum + r.seconds * 1000, 0)

  if (records.length === 0) {
    el.summaryMain.textContent = '还没有记录'
    el.summarySub.textContent = ''
  } else {
    el.summaryMain.textContent = `今天 ${fmtDur(todayMs)}`
    el.summarySub.textContent = todayRecs.length > 0 ? `共 ${todayRecs.length} 段` : '今天还没有学习'
  }

  if (records.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.dataset.u32Name = 'logs-empty'
    empty.textContent = '开始一次学习，记录会出现在这里'
    el.list.appendChild(empty)
    return
  }

  const groups = new Map()
  for (const r of records) {
    if (!groups.has(r.dayStartTs)) groups.set(r.dayStartTs, [])
    groups.get(r.dayStartTs).push(r)
  }

  const days = [...groups.entries()].sort((a, b) => b[0] - a[0])
  for (const [dayTs, list] of days) {
    const head = document.createElement('div')
    head.className = 'day-head'
    head.dataset.u32Name = 'day-head'
    const activeMs = list.filter((r) => r.status === 'active').reduce((s, r) => s + r.seconds * 1000, 0)
    head.textContent = `${dayLabel(dayTs)} · ${fmtDur(activeMs)}`
    el.list.appendChild(head)

    list.sort((a, b) => b.startTs - a.startTs)
    for (const r of list) {
      el.list.appendChild(rowOf(r))
    }
  }
}

function rowOf(r) {
  const row = document.createElement('div')
  row.className = 'row' + (r.status === 'void' ? ' void' : '')
  row.dataset.u32Name = 'logs-row'

  const mark = document.createElement('span')
  mark.className = 'mark' + (r.status === 'void' ? ' void-mark' : r.source === 'manual' ? ' manual' : '')
  mark.dataset.u32Name = 'logs-mark'
  row.appendChild(mark)

  const range = document.createElement('span')
  range.className = 'range'
  range.dataset.u32Name = 'logs-range'
  range.textContent = `${hm(r.startTs)} ~ ${hm(r.endTs)}`
  row.appendChild(range)

  const dur = document.createElement('span')
  dur.className = 'dur'
  dur.dataset.u32Name = 'logs-dur'
  dur.textContent = fmtDur(r.seconds * 1000)
  row.appendChild(dur)

  const reason = document.createElement('span')
  const isWarn = REASON_WARN.has(r.endReason)
  reason.className = 'reason' + (isWarn && r.status === 'active' ? ' warn' : '')
  reason.dataset.u32Name = 'logs-reason'
  if (r.status === 'void') reason.textContent = '已作废'
  else if (r.source === 'manual') reason.textContent = r.note || '补记'
  else reason.textContent = REASON_TEXT[r.endReason] || ''
  row.appendChild(reason)

  const action = document.createElement('button')
  action.className = 'action'
  action.dataset.u32Name = 'logs-action'
  if (r.source === 'timer') {
    action.textContent = r.status === 'void' ? '启用' : '作废'
    action.addEventListener('click', async () => {
      await window.api.setStatus(r.id, r.status === 'void' ? 'active' : 'void')
      await reload()
    })
  } else {
    action.textContent = '删除'
    action.addEventListener('click', async () => {
      await window.api.removeRecord(r.id)
      await reload()
    })
  }
  row.appendChild(action)

  return row
}

async function reload() {
  records = await window.api.records()
  render()
}

el.closeBtn.addEventListener('click', () => window.api.hideLogs())

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.hideLogs()
})

window.api.onState((s) => applySettings(s.settings))
window.api.onLogsRefresh(() => reload())
window.api.getState().then((s) => {
  applySettings(s.settings)
  reload()
})
