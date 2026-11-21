'use strict'

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Store } = require('../src/main/store')
const { Tracker } = require('../src/main/tracker')

const T0 = new Date(2026, 10, 21, 9, 0, 0, 0).getTime()

function makeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'))
  const store = new Store(dir)
  let now = T0
  let idle = 0
  const tracker = new Tracker(store, { now: () => now, getIdleMs: () => idle })
  const env = {
    store,
    tracker,
    setNow: (v) => { now = v },
    setInput: () => { idle = 0 },
    setIdle: (v) => { idle = v },
    run(from, to, withInput) {
      for (let sec = from; sec <= to; sec++) {
        now = T0 + sec * 1000
        idle = withInput ? 0 : (sec - from + 1) * 1000
        tracker.tick()
      }
    }
  }
  return env
}

const results = []
function test(name, fn) {
  try {
    fn()
    results.push(['PASS', name])
  } catch (err) {
    results.push(['FAIL', name + ' :: ' + err.message])
  }
}

/* 1. 一直有操作，目标到点结束 */
test('持续操作 10 分钟：到点结束，计入 600 秒', () => {
  const env = makeEnv()
  assert.strictEqual(env.tracker.begin(10).ok, true)
  env.run(1, 620, true)
  const rec = env.store.records[0]
  assert.ok(rec, '应写入一条记录')
  assert.strictEqual(rec.endReason, 'target')
  assert.strictEqual(rec.seconds, 600)
})

/* 2. 操作 60 秒后离开：150 秒预警、3 分钟整结束，计入 240 秒 */
test('操作 60 秒后离开：150 秒预警、3 分钟结束，计入 240 秒', () => {
  const env = makeEnv()
  const warnings = []
  env.tracker.on('idle-warning', () => warnings.push(env.tracker.now()))
  assert.strictEqual(env.tracker.begin(40).ok, true)
  env.run(1, 60, true)
  for (let sec = 61; sec <= 400; sec++) {
    env.setNow(T0 + sec * 1000)
    env.setIdle((sec - 60) * 1000)
    env.tracker.tick()
  }
  const rec = env.store.records[0]
  assert.ok(rec, '应写入一条记录')
  assert.strictEqual(rec.endReason, 'idle')
  assert.strictEqual(rec.seconds, 240)
  assert.strictEqual(warnings.length, 1, '预警只应发一次')
  assert.strictEqual(warnings[0], T0 + 210 * 1000, 'idleFor 达 150 秒的那个 tick 预警（最后一次操作后 2 分 30 秒）')
})

/* 2b. 预警后动了鼠标：预警作废，继续计时 */
test('预警后恢复操作：不结束、继续计时', () => {
  const env = makeEnv()
  let warned = 0
  env.tracker.on('idle-warning', () => { warned++ })
  assert.strictEqual(env.tracker.begin(10).ok, true)
  env.run(1, 60, true)
  for (let sec = 61; sec <= 211; sec++) {
    env.setNow(T0 + sec * 1000)
    env.setIdle((sec - 60) * 1000)
    env.tracker.tick()
  }
  assert.strictEqual(warned, 1, 'idleFor 达 150 秒（第 211 秒）已预警')
  assert.strictEqual(env.tracker.session != null, true, '会话应仍在')
  assert.strictEqual(env.tracker.snapshot().idleWarned, true)
  env.setInput() // 第 212 秒动了一下
  env.setNow(T0 + 212 * 1000)
  env.setIdle(0)
  env.tracker.tick()
  assert.strictEqual(env.tracker.session != null, true, '预警后动鼠标不应结束')
  env.run(213, 700, true) // 继续学满 10 分钟目标
  const recs = env.store.records
  assert.strictEqual(recs.length, 1)
  assert.strictEqual(recs[0].endReason, 'target', '应正常学满到点，而非 idle 结束')
  assert.strictEqual(recs[0].seconds, 600)
})

/* 3. 45 分钟滑动窗口：学 30 分 + 歇 2 分 + 再学 10 分即被拦下 */
test('45 分钟窗口内休息不足 5 分钟：自动结束', () => {
  const env = makeEnv()
  assert.strictEqual(env.tracker.begin(40).ok, true)
  env.run(1, 1800, true)
  env.tracker.stop('manual')
  env.setNow(T0 + 1920 * 1000)
  const second = env.tracker.begin(40)
  assert.strictEqual(second.ok, true, '歇了 2 分钟应该还能开始')

  for (let sec = 1921; sec <= 2700; sec++) {
    env.setNow(T0 + sec * 1000)
    env.setInput()
    env.tracker.tick()
  }
  const recs = env.store.records
  assert.strictEqual(recs.length, 2)
  assert.strictEqual(recs[1].endReason, 'rest')
  assert.ok(recs[1].seconds >= 600 && recs[1].seconds <= 640, `第二段应约 10 分钟，实际 ${recs[1].seconds}`)
})

/* 4. 启动前预检：窗口内学满 40 分钟后必须先休息 */
test('学满 40 分钟后禁止直接开始', () => {
  const env = makeEnv()
  env.store.addRecord({
    id: 'x1',
    startTs: T0,
    endTs: T0 + 2400 * 1000,
    dayStartTs: new Date(T0).setHours(0, 0, 0, 0),
    seconds: 2400,
    segments: [[T0, T0 + 2400 * 1000]],
    targetSec: 2400,
    source: 'timer',
    status: 'active',
    endReason: 'target'
  })
  env.setNow(T0 + 2400 * 1000)
  const res = env.tracker.begin(20)
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.error, 'rest')
  assert.ok(res.waitMs > 0, '应给出还需休息的时长')
})

/* 5. 断电/强杀后重启：只认最后落盘，不多记 */
test('异常退出恢复：不超过落盘时长', () => {
  const env = makeEnv()
  assert.strictEqual(env.tracker.begin(40).ok, true)
  env.run(1, 300, true)

  const store2 = new Store(path.dirname(env.store.file))
  const tracker2 = new Tracker(store2, { now: () => T0 + 300 * 1000 + 8 * 3600 * 1000, getIdleMs: () => 8 * 3600 * 1000 })
  tracker2.recover()

  const rec = store2.records[0]
  assert.ok(rec, '恢复后应生成记录')
  assert.strictEqual(rec.endReason, 'crash')
  assert.ok(rec.seconds > 0 && rec.seconds <= 300, `不应超过 300 秒，实际 ${rec.seconds}`)
})

/* 6. 跨天统计按片段归属 */
test('跨零点时今日时长只算当天部分', () => {
  const env = makeEnv()
  const dayStart = new Date(2026, 10, 21, 0, 0, 0, 0).getTime()
  env.store.addRecord({
    id: 'x2',
    startTs: dayStart - 1800 * 1000,
    endTs: dayStart + 1800 * 1000,
    dayStartTs: dayStart - 86400000,
    seconds: 3600,
    segments: [[dayStart - 1800 * 1000, dayStart + 1800 * 1000]],
    targetSec: 0,
    source: 'timer',
    status: 'active',
    endReason: 'manual'
  })
  env.setNow(dayStart + 3600 * 1000)
  const snap = env.tracker.snapshot()
  assert.strictEqual(Math.round(snap.todayMs / 1000), 1800, '今天只应算零点后的 30 分钟')
})

/* 7. 记录时间不允许重叠 */
test('补记与已有记录时间重叠：拒绝写入', () => {
  const env = makeEnv()
  env.store.addRecord({
    id: 'x3',
    startTs: T0,
    endTs: T0 + 1800 * 1000,
    dayStartTs: new Date(T0).setHours(0, 0, 0, 0),
    seconds: 1800,
    segments: [[T0, T0 + 1800 * 1000]],
    targetSec: 0,
    source: 'manual',
    status: 'active',
    endReason: 'manual'
  })
  assert.strictEqual(env.store.hasOverlap(T0 + 600 * 1000, T0 + 1200 * 1000), true, '完全落在已有段内')
  assert.strictEqual(env.store.hasOverlap(T0 + 1700 * 1000, T0 + 2300 * 1000), true, '半重叠')
  assert.strictEqual(env.store.hasOverlap(T0 + 1800 * 1000, T0 + 2400 * 1000), false, '首尾相接不算重叠')
  assert.strictEqual(env.store.hasOverlap(T0 - 600 * 1000, T0 - 1000), false, '之前时段不重叠')
  assert.strictEqual(env.store.hasOverlap(T0, T0 + 600 * 1000, 'x3'), false, '排除自身后不算重叠')
})

console.log('')
for (const [status, name] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name}`)
}
const failed = results.filter(([s]) => s === 'FAIL').length
console.log('')
console.log(`${results.length - failed}/${results.length} 通过`)
process.exit(failed === 0 ? 0 : 1)
