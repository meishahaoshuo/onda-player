import fs from 'node:fs'
import zlib from 'node:zlib'

/** 极简 PNG 解码（8bit 非隔行）→ { width, height, channels, data } */
export function decodePng(path) {
  const buf = fs.readFileSync(path)
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
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 0xff
    }
  }
  return { width, height, channels, data: out }
}

/** 两张同尺寸图的最大逐像素差值（返回 {maxDiff, diffPixels, total}） */
export function comparePng(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('尺寸不一致，无法比较')
  const n = a.width * a.height * a.channels
  let maxDiff = 0, diffPixels = 0
  for (let px = 0; px < a.width * a.height; px++) {
    const o = px * a.channels
    let d = 0
    for (let c = 0; c < a.channels; c++) d = Math.max(d, Math.abs(a.data[o + c] - b.data[o + c]))
    if (d > 0) diffPixels++
    if (d > maxDiff) maxDiff = d
  }
  return { maxDiff, diffPixels, total: a.width * a.height, pct: +((diffPixels / n) * 100).toFixed(4) }
}
