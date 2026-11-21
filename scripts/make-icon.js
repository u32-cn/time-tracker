'use strict'

/* 生成应用图标：蓝色圆角方块 + 白色表盘与指针，输出 build/icon.ico 与 build/icon.png */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

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

function chunk(type, data) {
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
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** 圆角方块的覆盖率，用于抗锯齿 */
function roundRectAlpha(x, y, size, radius) {
  const inset = size * 0.04
  const left = inset
  const right = size - inset
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, left + radius), right - radius)
  const dist = Math.hypot(x - cx, y - cy)
  return Math.max(0, Math.min(1, radius + 0.8 - dist))
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.235
  const ringOuter = size * 0.285
  const ringInner = size * 0.215

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const fx = x + 0.5
      const fy = y + 0.5
      const shapeA = roundRectAlpha(fx, fy, size, radius)
      if (shapeA <= 0) {
        px[i + 3] = 0
        continue
      }
      let r = 0x37
      let g = 0x8a
      let b = 0xdd

      const d = Math.hypot(fx - cx, fy - cy)
      if (d < ringOuter && d > ringInner) {
        r = 0xff
        g = 0xff
        b = 0xff
      }
      // 时针：指向 12 点方向
      if (Math.abs(fx - cx) < size * 0.032 && fy < cy && fy > cy - ringOuter * 0.62) {
        r = 0xff
        g = 0xff
        b = 0xff
      }
      // 分针：指向 4 点方向
      const ang = Math.atan2(fy - cy, fx - cx)
      const target = (Math.PI / 180) * 28
      if (Math.abs(ang - target) < 0.075 && d < ringOuter * 0.72 && d > size * 0.02) {
        r = 0xff
        g = 0xff
        b = 0xff
      }

      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = Math.round(255 * shapeA)
    }
  }
  return encodePNG(size, size, px)
}

function ico(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size
  entry[1] = size >= 256 ? 0 : size
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })

const big = draw(256)
fs.writeFileSync(path.join(outDir, 'icon.png'), big)
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico(big, 256))
fs.writeFileSync(path.join(outDir, 'tray.png'), draw(32))
console.log('图标已生成：build/icon.ico, build/icon.png, build/tray.png')
