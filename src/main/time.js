'use strict'

/** 本地时区当天零点的时间戳 */
function dayStartTs(ts = Date.now()) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 两个区间的交集长度 */
function overlapMs(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** 记录参与统计的有效片段；老数据没有 segments 时退化为整段 */
function recordSegments(rec) {
  if (Array.isArray(rec.segments) && rec.segments.length) return rec.segments
  return [[rec.startTs, rec.endTs]]
}

module.exports = { dayStartTs, overlapMs, uid, recordSegments }
