'use strict'

/* 生成一周的示例数据，仅用于截图和本地预览；用完执行 node scripts/seed-demo.js --clean 清掉 */
const fs = require('node:fs')
const path = require('node:path')

const APP_DIR = path.join(process.env.APPDATA, '每日学习计时器')
const FILE = path.join(APP_DIR, 'data.json')
const MIN = 60000

function dayStartOf(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

if (process.argv.includes('--clean')) {
  try {
    fs.unlinkSync(FILE)
    console.log('已删除演示数据')
  } catch {
    console.log('没有可删除的数据')
  }
  process.exit(0)
}

const today = dayStartOf(Date.now())

function mk(dayOffset, startHM, minutes, endReason) {
  const day = today + dayOffset * 86400000
  const [h, m] = startHM.split(':').map(Number)
  const startTs = day + h * 3600000 + m * MIN
  const endTs = startTs + minutes * MIN
  return {
    id: `seed${dayOffset}_${startHM.replace(':', '')}`,
    startTs,
    endTs,
    dayStartTs: day,
    seconds: minutes * 60,
    segments: [[startTs, endTs]],
    targetSec: 2400,
    source: 'timer',
    status: 'active',
    endReason
  }
}

const records = [
  mk(0, '08:10', 35, 'manual'),
  mk(0, '09:00', 40, 'target'),
  mk(0, '14:10', 40, 'target'),
  mk(0, '15:00', 32, 'idle'),
  mk(-1, '08:30', 40, 'target'),
  mk(-1, '09:20', 38, 'manual'),
  mk(-1, '16:00', 45, 'rest'),
  mk(-2, '09:00', 40, 'target'),
  mk(-3, '10:00', 60, 'manual'),
  mk(-3, '15:00', 40, 'target'),
  mk(-4, '09:30', 25, 'idle'),
  mk(-5, '14:00', 40, 'target'),
  mk(-5, '15:10', 30, 'manual'),
  mk(-6, '08:00', 40, 'target')
]

fs.mkdirSync(APP_DIR, { recursive: true })
const current = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {}
const next = {
  records,
  session: null,
  settings: current.settings || {}
}
fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8')
console.log(`已写入 ${records.length} 条演示记录 → ${FILE}`)
