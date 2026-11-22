'use strict'

/* 生成应用图标：白底红前景闹钟，输出 build/icon.ico 与 build/icon.png
 * 纯逐像素 SDF 绘制，无外部依赖，`npm run icon` 可复现 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { drawRGBA } = require('../src/shared/icon-glyph')

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

/* 几何全部来自 src/shared/icon-glyph.js（与主进程托盘图标同一份实现），
 * 这里只负责把它编码成 PNG / 多尺寸 ICO */

/* 32 位 BGRA + AND 掩码的 DIB 条目：Windows 对小尺寸图标的传统格式，
 * 比「只放一张 256 PNG 让系统自己缩」清晰得多 */
function dib(size, rgba) {
  const maskStride = Math.ceil(size / 32) * 4
  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y
    for (let x = 0; x < size; x++) {
      const s = (srcRow * size + x) * 4
      const d = (y * size + x) * 4
      xor[d] = rgba[s + 2]
      xor[d + 1] = rgba[s + 1]
      xor[d + 2] = rgba[s]
      xor[d + 3] = rgba[s + 3]
    }
  }
  const mask = Buffer.alloc(maskStride * size)
  const hdr = Buffer.alloc(40)
  hdr.writeUInt32LE(40, 0)
  hdr.writeInt32LE(size, 4)
  hdr.writeInt32LE(size * 2, 8)
  hdr.writeUInt16LE(1, 12)
  hdr.writeUInt16LE(32, 14)
  hdr.writeUInt32LE(xor.length, 20)
  return Buffer.concat([hdr, xor, mask])
}

/* 多尺寸 ICO：每个尺寸都按目标像素直接绘制，不靠缩放 */
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

function encodeICO(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = 6 + entries.length * 16
  const dir = []
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    dir.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)])
}

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })

const big = drawRGBA(256)
fs.writeFileSync(path.join(outDir, 'icon.png'), encodePNG(256, 256, big))

const entries = ICO_SIZES.map((size) => ({
  size,
  /* 256 用 PNG（体积小、Vista+ 通用），其余用 DIB 以匹配 Windows 小尺寸渲染路径 */
  data: size >= 256 ? encodePNG(256, 256, big) : dib(size, drawRGBA(size))
}))
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(entries))

/* 只产出 icon.ico / icon.png 两件：
 * 托盘图标直接读 icon.ico（由系统按 DPI 挑尺寸），不再单独生成 tray.png */
