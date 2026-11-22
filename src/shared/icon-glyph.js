'use strict'

/* 图标几何的唯一实现：应用图标（build/icon.ico）与托盘图标共用，
 * 避免两处各写一份导致图形不一致。
 *
 * 设计：白色圆角方块铺满画布 + 红色闹钟（双铃铛、底座、12 点与 4 点指针）。
 * 每个输出尺寸都按目标像素直接绘制 SDF，不依赖缩放，避免缩图糊边。
 */

const BG_RADIUS = 52
const RED = [212, 43, 43]
const WHITE = [255, 255, 255]

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r

function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - hx + r
  const qy = Math.abs(py - cy) - hy + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function sdSegment(px, py, ax, ay, bx, by, r) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - bax * h, pay - bay * h) - r
}

/* 各尺寸的光学参数（sw 为 256 坐标系下的描边半径）：
 * - 小尺寸描边必须 >= 1 物理像素，否则红线只剩半透明粉色，看起来就是「糊」
 * - 24px 以下铃铛与底座只有半个像素，留着只会和表盘粘成一坨，因此只保留表盘+指针
 * - hand/dot 是相对描边的粗细系数，小尺寸收细指针、大尺寸保持原比例 */
function paramsFor(size) {
  if (size <= 16) return { scale: 0.95, sw: (0.9 * 256) / size, details: false, hand: 0.9, dot: 1 }
  if (size <= 20) return { scale: 1.02, sw: (1.2 * 256) / size, details: false, hand: 0.9, dot: 1 }
  if (size <= 24) return { scale: 1.06, sw: (1.2 * 256) / size, details: false, hand: 0.9, dot: 1 }
  if (size <= 32) return { scale: 1.1, sw: (1.0 * 256) / size, details: true, hand: 1, dot: 1.1 }
  return { scale: 1.12, sw: Math.max(7, (1.1 * 256) / size), details: true, hand: 1, dot: 1.1 }
}

/* 闹钟形状的 SDF 并集（负 = 形状内部），256 坐标系 */
function alarmSDF(x, y, scale, sw, details, hand, dot) {
  const gx = 128 + (x - 128) / scale
  const gy = 134 + (y + 6 - 134) / scale
  const hw = sw * hand
  const parts = [
    Math.abs(Math.hypot(gx - 128, gy - 136) - 76) - sw,
    sdSegment(gx, gy, 128, 136, 128, 88, hw),
    sdSegment(gx, gy, 128, 136, 160, 156, hw),
    sdCircle(gx, gy, 128, 136, Math.max(details ? 8 : 4, sw * dot))
  ]
  if (details) {
    parts.push(
      sdSegment(gx, gy, 70, 52, 94, 66, sw),
      sdSegment(gx, gy, 186, 52, 162, 66, sw),
      sdSegment(gx, gy, 96, 216, 160, 216, sw)
    )
  }
  return Math.min(...parts)
}

/** 返回 size×size 的 RGBA Buffer（左上到右下逐行） */
function drawRGBA(size) {
  const px = Buffer.alloc(size * size * 4)
  const scaleFactor = size / 256
  const { scale, sw, details, hand, dot } = paramsFor(size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const fx = (x + 0.5) / scaleFactor
      const fy = (y + 0.5) / scaleFactor
      const bgD = sdRoundRect(fx, fy, 128, 128, 128, 128, BG_RADIUS)
      const glyphD = alarmSDF(fx, fy, scale, sw, details, hand, dot)
      const d = Math.min(bgD, glyphD)
      const aa = Math.max(0, Math.min(1, 0.5 - d))
      if (aa <= 0) continue
      const color = glyphD < 0 ? RED : WHITE
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
      px[i + 3] = Math.round(255 * aa)
    }
  }
  return px
}

module.exports = { drawRGBA, paramsFor, BG_RADIUS }
