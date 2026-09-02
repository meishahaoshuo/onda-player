/**
 * 歌词页/详情页封面氛围取色：
 * 把封面分块采样得到 N 个色焦点，多焦点 radial 互相渗透形成"环境光晕"，
 * 而不是"缩封面 → 单层 CSS blur"（那种颜色构图不准，也做不出多焦点融合）。
 *
 * 两个出口：
 * - makeAmbientGradient(blob)：返回多 background-image 的 CSS 字符串（专辑详情等单层场景）。
 * - renderAmbientUrl(blob)：把全部焦点画到一张小画布再烘焙一次 canvas blur，
 *   导出 PNG dataURL（歌词页用）。模糊已在图内，上层无需 CSS filter，从而避免
 *   多个全屏 blur(80px) 图层在飞入/切歌时并行栅格化——这是卡顿的根因。
 */

interface Focus {
  r: number
  g: number
  b: number
  /** 焦点中心位置（百分比 0-100） */
  x: number
  y: number
}

/** 从 64×N 采样像素里算出：焦点列表（已压暗）+ 全局 base 色（已压暗）。 */
function computeAmbient(data: Uint8ClampedArray, W: number, H: number) {
  const gridX = 4
  const gridY = 3
  let globalR = 0
  let globalG = 0
  let globalB = 0
  const blockColors: {
    r: number
    g: number
    b: number
    n: number
    min: number
    max: number
    lum: number
  }[] = []
  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      let r = 0,
        g = 0,
        b = 0,
        n = 0
      const sy = Math.floor((gy * H) / gridY)
      const ey = Math.floor(((gy + 1) * H) / gridY)
      const sx = Math.floor((gx * W) / gridX)
      const ex = Math.floor(((gx + 1) * W) / gridX)
      for (let y = sy; y < ey; y++) {
        for (let x = sx; x < ex; x++) {
          const i = (y * W + x) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
      }
      const rm = Math.round(r / n)
      const gm = Math.round(g / n)
      const bm = Math.round(b / n)
      blockColors.push({
        r: rm,
        g: gm,
        b: bm,
        n,
        min: Math.min(rm, gm, bm),
        max: Math.max(rm, gm, bm),
        lum: (rm + gm + bm) / 3,
      })
      globalR += rm
      globalG += gm
      globalB += bm
    }
  }
  const totalBlocks = gridX * gridY
  const avgR = globalR / totalBlocks
  const avgG = globalG / totalBlocks
  const avgB = globalB / totalBlocks
  const avgLum = (avgR + avgG + avgB) / 3

  // 全局压暗系数：暗封面（≤120）不压，亮封面（≥230）逐渐压到 0.55，
  // 中间平滑过渡，替代原来的硬性阶梯，浅色封面不再被一刀切压暗。
  const t = Math.min(1, Math.max(0, (avgLum - 120) / 110))
  const dim = 1 - 0.45 * t

  const foci: Focus[] = []
  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      const c = blockColors[gy * gridX + gx]
      // 接近黑色的色块跳过：避免给本就暗的画面引入无意义黑色焦点
      if (c.max < 32) continue
      // 高亮块降权：仅跳过近乎纯白/单品色的像素，避免把封面主体色误滤掉
      if (c.lum > 236 && c.max - c.min < 18) continue
      foci.push({
        r: Math.round(c.r * dim),
        g: Math.round(c.g * dim),
        b: Math.round(c.b * dim),
        x: ((gx + 0.5) / gridX) * 100,
        y: ((gy + 0.5) / gridY) * 100,
      })
    }
  }

  const base = {
    r: Math.round(avgR * dim),
    g: Math.round(avgG * dim),
    b: Math.round(avgB * dim),
  }
  return { foci, base }
}

/** 取一张 64×N 采样画布（读回像素供 computeAmbient 使用）。 */
async function sampleBitmap(blob: Blob): Promise<{
  W: number
  H: number
  data: Uint8ClampedArray
  bitmap: ImageBitmap
}> {
  const bitmap = await createImageBitmap(blob)
  const W = 64
  const H = Math.max(64, Math.round((W * bitmap.height) / bitmap.width))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, W, H)
  const { data } = ctx.getImageData(0, 0, W, H)
  return { W, H, data, bitmap }
}

/** 多背景 image 的 CSS 字符串（单层场景：专辑详情头图等）。 */
export async function makeAmbientGradient(blob: Blob): Promise<string> {
  const { W, H, data, bitmap } = await sampleBitmap(blob)
  try {
    const { foci, base } = computeAmbient(data, W, H)
    const radials = foci.map(
      (f) =>
        `radial-gradient(circle at ${f.x.toFixed(1)}% ${f.y.toFixed(1)}%, rgb(${f.r},${f.g},${f.b}) 0%, rgba(${f.r},${f.g},${f.b},0) 60%)`,
    )
    const baseCss = `linear-gradient(rgb(${base.r},${base.g},${base.b}), rgb(${base.r},${base.g},${base.b}))`
    return radials.length ? `${radials.join(', ')}, ${baseCss}` : baseCss
  } finally {
    bitmap.close()
  }
}

/**
 * 预烘焙成单张柔和模糊图（PNG dataURL）。
 * 把全部焦点 radial + base 画到 ~160×90 小画布，再叠一层 canvas blur 柔化边缘，
 * 导出后供 .bg-ambient 用 background-size:cover 拉伸——无需 CSS filter，单层一次栅格化。
 */
export async function renderAmbientUrl(blob: Blob): Promise<string> {
  const { W, H, data, bitmap } = await sampleBitmap(blob)
  try {
    const { foci, base } = computeAmbient(data, W, H)
    const OUT_W = 160
    const OUT_H = 90
    const temp = document.createElement('canvas')
    temp.width = OUT_W
    temp.height = OUT_H
    const tctx = temp.getContext('2d')!
    tctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`
    tctx.fillRect(0, 0, OUT_W, OUT_H)
    const radius = Math.max(OUT_W, OUT_H) * 0.75
    for (const f of foci) {
      const cx = (f.x / 100) * OUT_W
      const cy = (f.y / 100) * OUT_H
      const grad = tctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
      grad.addColorStop(0, `rgba(${f.r},${f.g},${f.b},1)`)
      grad.addColorStop(0.6, `rgba(${f.r},${f.g},${f.b},0)`)
      tctx.fillStyle = grad
      tctx.fillRect(0, 0, OUT_W, OUT_H)
    }
    // 烘焙 blur：先垫同色 base 底，避免模糊边缘透出透明而露黑
    const out = document.createElement('canvas')
    out.width = OUT_W
    out.height = OUT_H
    const octx = out.getContext('2d')!
    octx.fillStyle = `rgb(${base.r},${base.g},${base.b})`
    octx.fillRect(0, 0, OUT_W, OUT_H)
    octx.filter = 'blur(6px) saturate(1.06)'
    octx.drawImage(temp, 0, 0)
    octx.filter = 'none'
    return out.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
}
