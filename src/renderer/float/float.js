'use strict'

const $ = (id) => document.getElementById(id)

const capsule = $('capsule')
const dot = $('dot')
const clock = $('clock')
const today = $('today')
const stopBtn = $('stopBtn')

let prevRunning = false
let flash = null
let drag = null
let rafId = 0
let pendingMove = null

function pad(n) {
  return String(n).padStart(2, '0')
}

function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function fmtShort(ms) {
  const min = Math.round(ms / 60000)
  if (min < 1) return '0m'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h${m}m`
}

function applySettings(s) {
  if (!s) return
  document.documentElement.dataset.theme = s.theme === 'dark' ? 'dark' : 'light'
  const fs = Math.max(0.85, Math.min(1.2, Number(s.fontScale) || 1))
  document.documentElement.style.setProperty('--fs', fs)
}

function render(s) {
  applySettings(s.settings)
  today.textContent = fmtShort(s.todayMs)

  if (flash && Date.now() < flash.until) {
    dot.className = 'dot warn'
    clock.className = 'clock num warn'
    clock.textContent = flash.text
    stopBtn.hidden = true
    return
  }
  flash = null

  if (s.running) {
    clock.className = 'clock num'
    clock.textContent = fmtClock(s.remainingMs)
    stopBtn.hidden = false
    if (s.idleMs >= 60000) {
      dot.className = 'dot warn'
      clock.classList.add('warn')
    } else {
      dot.className = 'dot run'
    }
  } else {
    clock.className = 'clock num idle-text'
    clock.textContent = '未开始'
    stopBtn.hidden = true
    dot.className = s.canStart ? 'dot' : 'dot warn'
  }

  if (prevRunning && !s.running && !flash) {
    flash = { text: '已结束', until: Date.now() + 2600 }
    dot.className = 'dot warn'
    clock.className = 'clock num warn'
    clock.textContent = flash.text
  }
  prevRunning = s.running
}

/* ---------- 拖动 / 点击 ---------- */
capsule.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if (e.target.closest('.stop-btn')) return
  drag = { sx: e.screenX, sy: e.screenY, ox: e.clientX, oy: e.clientY, moved: false }
})

window.addEventListener('mousemove', (e) => {
  if (!drag) return
  const dx = e.screenX - drag.sx
  const dy = e.screenY - drag.sy
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
    drag.moved = true
    document.body.classList.add('dragging')
  }
  if (!drag.moved) return
  pendingMove = [e.screenX - drag.ox, e.screenY - drag.oy]
  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      rafId = 0
      if (pendingMove) {
        window.api.move(pendingMove[0], pendingMove[1])
        pendingMove = null
      }
    })
  }
})

window.addEventListener('mouseup', () => {
  if (!drag) return
  const moved = drag.moved
  drag = null
  document.body.classList.remove('dragging')
  if (!moved) window.api.openPanel()
})

capsule.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.api.openPanel()
})

stopBtn.addEventListener('mousedown', (e) => e.stopPropagation())
stopBtn.addEventListener('click', async (e) => {
  e.stopPropagation()
  await window.api.stop()
})

/* ---------- 启动 ---------- */
window.api.onState(render)
window.api.getState().then(render)

setInterval(() => {
  if (flash && Date.now() >= flash.until) {
    flash = null
    window.api.getState().then(render)
  }
}, 500)
