import fs from 'node:fs'
import zlib from 'node:zlib'

/* 极简 PNG 解码（8bit，非隔行）：只为本项目量取参考截图中图标的像素位置 */
const imgPath = process.argv[2]
const buf = fs.readFileSync(imgPath)

let pos = 8
let width = 0, height = 0, colorType = 0, bitDepth = 0
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
    bitDepth = data[8]
    colorType = data[9]
  } else if (type === 'IDAT') idat.push(data)
  else if (type === 'IEND') break
  pos += 12 + len
}

const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
if (bitDepth !== 8 || !channels) throw new Error(`不支持的 PNG：depth=${bitDepth} color=${colorType}`)

const raw = zlib.inflateSync(Buffer.concat(idat))
const bpp = channels
const stride = width * bpp
const out = Buffer.alloc(height * stride)

let p = 0
for (let y = 0; y < height; y++) {
  const filter = raw[p++]
  const line = raw.subarray(p, p + stride)
  p += stride
  const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
  const cur = out.subarray(y * stride, (y + 1) * stride)
  for (let i = 0; i < stride; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0
    const b = prev[i]
    const c = i >= bpp ? prev[i - bpp] : 0
    let v = line[i]
    if (filter === 1) v = (v + a) & 0xff
    else if (filter === 2) v = (v + b) & 0xff
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
    else if (filter === 4) {
      const pp = a + b - c
      const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
      v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
    }
    cur[i] = v
  }
}

const lum = (x, y) => {
  const o = y * stride + x * bpp
  return 0.299 * out[o] + 0.587 * out[o + 1] + 0.114 * out[o + 2]
}

const TH = Number(process.argv[3] ?? 150)

/* 只在右侧区域找图标：统计每列暗像素数，再按空列切分簇 */
const startX = Math.floor(width * 0.78)
const cols = []
for (let x = startX; x < width; x++) {
  let n = 0
  for (let y = 0; y < height; y++) if (lum(x, y) < TH) n++
  cols.push({ x, n })
}

const clusters = []
let cur = null
for (const c of cols) {
  if (c.n > 0) {
    if (!cur) cur = { x0: c.x, x1: c.x }
    else cur.x1 = c.x
  } else if (cur) {
    clusters.push(cur)
    cur = null
  }
}
if (cur) clusters.push(cur)

const info = clusters.map((cl) => {
  let y0 = Infinity, y1 = -Infinity, total = 0
  for (let x = cl.x0; x <= cl.x1; x++) {
    for (let y = 0; y < height; y++) {
      if (lum(x, y) < TH) {
        total++
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return {
    宽: cl.x1 - cl.x0 + 1,
    左: cl.x0,
    右: cl.x1,
    中心x: +((cl.x0 + cl.x1) / 2).toFixed(1),
    上: y0,
    下: y1,
    高: y1 - y0 + 1,
    中心y: +((y0 + y1) / 2).toFixed(1),
    距右边缘: width - 1 - cl.x1,
    像素数: total,
  }
})

console.log(JSON.stringify({ 图像: { width, height, colorType }, 阈值: TH, 起始扫描列: startX, 簇: info }, null, 2))
