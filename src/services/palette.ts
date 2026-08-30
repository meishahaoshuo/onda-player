/**
 * 封面主色提取：把封面缩小采样、量化统计频次，
 * 挑出彼此差异最大的前 N 个颜色并做饱和度/明度调整，
 * 用于歌词页的渐变背景。
 */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToCss(h: number, s: number, l: number, alpha = 1): string {
  return `hsla(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${alpha})`
}

/** 提取调色板（css 颜色字符串数组） */
export async function extractPalette(source: Blob | ImageBitmap, count = 3): Promise<string[]> {
  const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source)
  try {
    const size = 48
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)

    // 量化到 5bit/通道 的桶里统计频次
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      if (a < 128) continue
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.n++
        bucket.r += r
        bucket.g += g
        bucket.b += b
      } else {
        buckets.set(key, { n: 1, r, g, b })
      }
    }

    // 按频次排序，跳过太亮/太暗/太灰的桶，选彼此色距足够大的前 count 个
    const sorted = [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .map((bk) => {
        const r = bk.r / bk.n
        const g = bk.g / bk.n
        const b = bk.b / bk.n
        const [h, s, l] = rgbToHsl(r, g, b)
        return { h, s, l, n: bk.n }
      })
      .filter((c) => c.l > 0.08 && c.l < 0.92)

    const picked: typeof sorted = []
    for (const c of sorted) {
      if (picked.length >= count) break
      const farEnough = picked.every((p) => {
        // 色相环距离 + 明度差
        const dh = Math.min(Math.abs(p.h - c.h), 1 - Math.abs(p.h - c.h))
        return dh > 0.12 || Math.abs(p.l - c.l) > 0.18
      })
      if (farEnough || picked.length === 0) picked.push(c)
    }

    // 提升饱和度、压进中等明度区间，让渐变浓郁（对照截图的鲜艳效果）
    return picked.map((c) => {
      const s = Math.min(1, Math.max(c.s, 0.35) * 1.25)
      const l = Math.min(0.62, Math.max(0.3, c.l))
      return hslToCss(c.h, s, l)
    })
  } finally {
    if (source instanceof ImageBitmap) bitmap.close()
  }
}
