'use strict'

const $ = (id) => document.getElementById(id)

const ICON_DONE = '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M4 9.2l3.4 3.4L14 5.6" fill="none" stroke="#9A5528" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_CLOCK = '<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.8" fill="none" stroke="#8A5A16" stroke-width="1.5"/><path d="M9 5v4.4l2.6 1.6" fill="none" stroke="#8A5A16" stroke-width="1.5" stroke-linecap="round"/></svg>'

function pad(n) {
  return String(n).padStart(2, '0')
}

function fmtDur(ms) {
  const min = Math.round(ms / 60000)
  if (min < 1) return '不足 1 分钟'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} 分钟`
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

function fmtMinSec(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/* ---------- 钟声：三声一组，共五组，约 10 秒 ---------- */
function chime(ctx, t, freq) {
  const partials = [
    { f: freq, gain: 0.3, decay: 1.4 },
    { f: freq * 2, gain: 0.1, decay: 0.9 },
    { f: freq * 2.76, gain: 0.05, decay: 0.6 }
  ]
  for (const p of partials) {
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(p.gain, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + p.decay)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = p.f
    osc.connect(gain)
    osc.start(t)
    osc.stop(t + p.decay + 0.1)
  }
}

function playBell() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime + 0.06
    for (let g = 0; g < 5; g++) {
      const base = now + g * 2.0
      chime(ctx, base, 880)
      chime(ctx, base + 0.45, 659.25)
      chime(ctx, base + 0.9, 523.25)
    }
    setTimeout(() => ctx.close(), 11500)
  } catch {
    /* 静音失败不影响提示 */
  }
}

function render(payload) {
  const { record, reason, snap } = payload
  const icon = $('icon')
  const hint = $('hint')

  if (reason === 'target') {
    $('title').textContent = '本次学习已完成'
    icon.innerHTML = ICON_DONE
    icon.className = 'icon'
    $('desc').textContent = `本次计入 ${fmtDur(record.seconds * 1000)}`
  } else if (reason === 'rest') {
    $('title').textContent = '休息不足，已自动结束'
    icon.innerHTML = ICON_CLOCK
    icon.className = 'icon warn'
    $('desc').textContent = `本次计入 ${fmtDur(record.seconds * 1000)}`
    hint.hidden = false
    hint.textContent = snap && snap.restWaitMs > 0
      ? `还要休息 ${fmtMinSec(snap.restWaitMs)} 才能再次开始`
      : '最近 45 分钟内休息不足 5 分钟'
  } else if (reason === 'idle-warning') {
    const left = snap ? Math.max(0, snap.remainingWarnMs) : 0
    $('title').textContent = '已经 3 分钟没有操作'
    icon.innerHTML = ICON_CLOCK
    icon.className = 'icon warn'
    $('desc').textContent = '动了鼠标就继续计时，什么都不做则结束'
    hint.hidden = false
    hint.textContent = left > 0
      ? `${fmtMinSec(left)} 后将自动结束本次学习`
      : '1 分钟后没有操作将自动结束'
  } else {
    $('title').textContent = '无操作 3 分钟，已结束'
    icon.innerHTML = ICON_CLOCK
    icon.className = 'icon warn'
    $('desc').textContent = `本次计入 ${fmtDur(record.seconds * 1000)}，离开的时间没有算`
    hint.hidden = false
    hint.textContent = '动一下鼠标这个提示就会消失'
  }

  if (!(payload.sound === false)) playBell()
}

$('okBtn').addEventListener('click', () => window.api.closeNotice())

window.api.onNotice(render)
