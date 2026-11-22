'use strict'

const { EventEmitter } = require('node:events')
const { powerMonitor } = require('electron')
const { dayStartTs, overlapMs, uid, recordSegments } = require('./time')

const TICK_MS = 1000                        // 采样/记账粒度
const IDLE_STOP_MS = 180 * 1000             // 无操作 3 分钟即结束，写死不放设置
const IDLE_WARN_AT_MS = 150 * 1000          // 无操作 2 分 30 秒时预警一次
const REST_WINDOW_MS = 45 * 60 * 1000       // 滑动窗口 45 分钟
const REST_GAP_MS = 5 * 60 * 1000           // 窗口内最低休息 5 分钟
const MAX_STUDY_MS = REST_WINDOW_MS - REST_GAP_MS  // 由此推出单次上限 40 分钟
const MIN_BLOCK_MS = 60 * 1000              // 开始前至少还能学 1 分钟
const PERSIST_MS = 15 * 1000                // 会话落盘间隔

class Tracker extends EventEmitter {
  constructor(store, opts = {}) {
    super()
    this.store = store
    this.session = null
    this.timer = null
    this.lastPersistTs = 0
    this.systemIdleMs = 0
    this.idleWarned = false
    this.pmBound = false
    this._now = opts.now || (() => Date.now())
    this._idle = opts.getIdleMs || (() => {
      try {
        return powerMonitor.getSystemIdleTime() * 1000
      } catch {
        return 0
      }
    })
  }

  now() {
    return this._now()
  }

  /** 仅 TT_DEBUG=1 时把每次 tick 的输入采样写到启动日志 */
  debugTick(msg) {
    if (!process.env.TT_DEBUG) return
    try {
      require('node:fs').appendFileSync(
        require('node:os').tmpdir() + '/tt-tick.log',
        `[${new Date().toISOString()}] ${msg}\n`
      )
    } catch { /* 日志失败不影响计时 */ }
  }

  start() {
    this.recover()
    if (!this.pmBound && powerMonitor && typeof powerMonitor.on === 'function') {
      this.pmBound = true
      powerMonitor.on('lock-screen', () => this.stop('lock'))
      powerMonitor.on('suspend', () => this.stop('sleep'))
    }
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  /** 上次没正常结束（断电/强杀）留下的会话：按快照结算，不做任何补偿 */
  recover() {
    const s = this.store.session
    if (!s) return
    this.finalize(s, 'crash')
    this.store.setSession(null)
    this.store.save()
  }

  tick() {
    const now = this.now()

    const idleMs = this._idle()
    this.systemIdleMs = idleMs
    this.debugTick(`tick t=+${((now - (this.bootTs || (this.bootTs = now))) / 1000).toFixed(1)}s idle=${(idleMs / 1000).toFixed(1)}s`)

    if (this.session) {
      const s = this.session
      const refreshed = idleMs < TICK_MS + 500
      if (refreshed) {
        s.lastInputTs = now - idleMs
        this.idleWarned = false
      }
      this.debugTick(`  session idleFor=${((now - s.lastInputTs) / 1000).toFixed(1)}s refreshed=${refreshed}`)

      this.settle(s, now)

      const idleFor = now - s.lastInputTs
      if (s.accruedMs >= s.targetSec * 1000) {
        this.debugTick('  STOP target')
        this.stop('target')
      } else if (idleFor >= IDLE_STOP_MS) {
        this.debugTick(`  STOP idle (idleFor=${(idleFor / 1000).toFixed(1)}s, tickIdle=${(idleMs / 1000).toFixed(1)}s)`)
        this.stop('idle')
      } else if (idleFor >= IDLE_WARN_AT_MS && !this.idleWarned) {
        this.idleWarned = true
        this.emit('idle-warning', this.snapshot())
      } else if (this.studiedMsInWindow(now) > MAX_STUDY_MS) {
        this.stop('rest')
      } else if (now - this.lastPersistTs >= PERSIST_MS) {
        this.persist()
      }
    }
    this.emit('tick', this.snapshot())
  }

  /** 记账：任何一段最多算到「最后一次操作 + 3 分钟」 */
  settle(s, now) {
    const upper = Math.min(now, s.lastInputTs + IDLE_STOP_MS)
    if (upper > s.lastAccountTs) {
      this.account(s, s.lastAccountTs, upper)
      s.lastAccountTs = upper
    }
  }

  account(s, from, to) {
    if (to <= from) return
    s.accruedMs += to - from
    const segs = s.segments
    const last = segs[segs.length - 1]
    if (last && last[1] === from) last[1] = to
    else segs.push([from, to])
  }

  persist() {
    if (this.session) this.store.setSession(this.session)
    this.store.save()
    this.lastPersistTs = this.now()
  }

  begin(targetMin) {
    if (this.session) return { ok: false, error: 'running' }
    this.idleWarned = false
    const targetSec = Math.round(targetMin * 60)
    if (!(targetSec >= 60 && targetSec <= MAX_STUDY_MS / 1000)) {
      return { ok: false, error: 'range' }
    }
    const pre = this.canStart()
    if (!pre.ok) return pre
    /* 45 分钟窗口约束：目标不能超过本次实际可用额度，超额拒绝并返回额度 */
    if (targetSec * 1000 > pre.maxStudyMs) {
      return { ok: false, error: 'exceed', maxStudyMs: pre.maxStudyMs }
    }

    const now = this.now()
    this.session = {
      id: uid(),
      startTs: now,
      targetSec,
      accruedMs: 0,
      lastInputTs: now,
      lastAccountTs: now,
      segments: []
    }
    this.persist()
    this.emit('tick', this.snapshot())
    return { ok: true }
  }

  stop(reason = 'manual') {
    if (!this.session) return null
    const s = this.session
    this.settle(s, this.now())
    this.session = null
    this.store.setSession(null)
    const record = this.finalize(s, reason)
    this.store.save()
    this.emit('ended', { record, reason })
    this.emit('tick', this.snapshot())
    return record
  }

  finalize(s, reason) {
    const seconds = Math.round(s.accruedMs / 1000)
    const record = {
      id: s.id,
      startTs: s.startTs,
      endTs: s.lastAccountTs,
      dayStartTs: dayStartTs(s.startTs),
      seconds,
      segments: s.segments,
      targetSec: s.targetSec,
      source: 'timer',
      status: 'active',
      endReason: reason
    }
    if (seconds >= 1) this.store.addRecord(record)
    return record
  }

  canStart() {
    const now = this.now()
    const studied = this.studiedMsInWindow(now)
    const maxStudyMs = MAX_STUDY_MS - studied
    if (maxStudyMs < MIN_BLOCK_MS) {
      return { ok: false, error: 'rest', waitMs: this.restWaitMs(now), maxStudyMs: 0 }
    }
    return { ok: true, maxStudyMs }
  }

  /** 最近 45 分钟里已学习多少毫秒 */
  studiedMsInWindow(now) {
    const winStart = now - REST_WINDOW_MS
    let ms = 0
    for (const rec of this.store.records) {
      if (rec.status !== 'active') continue
      if (rec.endTs < winStart) continue
      for (const [a, b] of recordSegments(rec)) {
        ms += overlapMs(a, b, winStart, now)
      }
    }
    if (this.session) {
      for (const [a, b] of this.session.segments) {
        ms += overlapMs(a, b, winStart, now)
      }
    }
    return ms
  }

  /** 还要等多久才能重新开始（让窗口内学习降到「上限 - 1 分钟」以下） */
  restWaitMs(now) {
    const winStart = now - REST_WINDOW_MS
    const needOut = this.studiedMsInWindow(now) - (MAX_STUDY_MS - MIN_BLOCK_MS)
    if (needOut <= 0) return 0

    const segs = []
    for (const rec of this.store.records) {
      if (rec.status !== 'active') continue
      for (const seg of recordSegments(rec)) segs.push(seg)
    }
    if (this.session) segs.push(...this.session.segments)
    segs.sort((x, y) => x[0] - y[0])

    let acc = 0
    for (const [a, b] of segs) {
      const s = Math.max(a, winStart)
      const e = Math.min(b, now)
      if (e <= s) continue
      const len = e - s
      if (acc + len >= needOut) {
        const t = s + (needOut - acc)
        return t + REST_WINDOW_MS - now
      }
      acc += len
    }
    return 0
  }

  todayMs(now) {
    const dayStart = dayStartTs(now)
    let ms = 0
    for (const rec of this.store.records) {
      if (rec.status !== 'active') continue
      for (const [a, b] of recordSegments(rec)) ms += overlapMs(a, b, dayStart, now)
    }
    if (this.session) {
      for (const [a, b] of this.session.segments) ms += overlapMs(a, b, dayStart, now)
    }
    return ms
  }

  snapshot() {
    const now = this.now()
    const s = this.session
    const studied = this.studiedMsInWindow(now)
    const restMs = Math.max(0, REST_WINDOW_MS - studied)
    return {
      running: !!s,
      sessionId: s ? s.id : null,
      elapsedMs: s ? s.accruedMs : 0,
      targetMs: s ? s.targetSec * 1000 : 0,
      remainingMs: s ? Math.max(0, s.targetSec * 1000 - s.accruedMs) : 0,
      idleMs: s ? Math.max(0, now - s.lastInputTs) : 0,
      idleWarned: !!s && this.idleWarned,
      remainingWarnMs: s ? Math.max(0, IDLE_STOP_MS - (now - s.lastInputTs)) : 0,
      segments: s ? s.segments : [],
      todayMs: this.todayMs(now),
      restMs,
      restNeedMs: Math.max(0, REST_GAP_MS - restMs),
      maxStudyMs: Math.max(0, MAX_STUDY_MS - studied),
      canStart: !s && this.canStart().ok,
      restWaitMs: !s ? this.restWaitMs(now) : 0,
      serverTs: now
    }
  }
}

module.exports = { Tracker, IDLE_STOP_MS, IDLE_WARN_AT_MS, REST_WINDOW_MS, REST_GAP_MS, MAX_STUDY_MS }
