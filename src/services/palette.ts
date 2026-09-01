/**
 * 歌词页环境背景：把封面分块采样得到 N 个色焦点，
 * 每个焦点输出一个 radial-gradient，最后叠在一起形成"环境光晕"——多色焦点互相渗透。
 *
 * 不再依赖「缩小封面 → CSS blur」的老路（那种方式只是单层模糊，颜色构图不准，
 * 也无法形成参考图中那种"左上偏暖、右下偏冷"的多焦点融合感）。
 *
 * 输出：可作为 `background-image` 的纯 CSS 字符串（多 background-image 逗号拼接）。
 */

export async function makeAmbientGradient(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  try {
    // 缩图到 64×N 像素：保留颜色构图但方便分块采样；不需太大
    const W = 64
    const H = Math.max(64, Math.round((W * bitmap.height) / bitmap.width))
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, W, H)
    const { data } = ctx.getImageData(0, 0, W, H)

    // 分块：横向 4 块、纵向 3 块 = 12 个采样点（再多就会互相覆盖失真）
const gridX = 4
  const gridY = 3
  const radials: string[] = []

  // 一次扫描算两件事：每块平均色 + 整图总平均亮度（决定全局压暗比例）
  let globalR = 0
  let globalG = 0
  let globalB = 0
  const blockColors: { r: number; g: number; b: number; n: number; min: number; max: number; lum: number }[] = []
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
      blockColors.push({ r: rm, g: gm, b: bm, n, min: Math.min(rm, gm, bm), max: Math.max(rm, gm, bm), lum: (rm + gm + bm) / 3 })
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

  // 全局压暗系数：
  //   亮封面（>180）强压（×0.55）→ 浅色封面不会炸成白色雾团
  //   中亮（120-180）中压（×0.75）→ 标准
  //   暗封面（<120）不压（×1.0）→ 保持原本的沉郁粉紫
  // 同时作为 base 色与所有焦点色的统一缩放因子。
  const dim =
    avgLum > 180 ? 0.55 : avgLum > 120 ? 0.75 : 1.0

  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      const c = blockColors[gy * gridX + gx]
      // 接近黑色的色块跳过：避免给本就暗的画面引入过多无意义黑色焦点
      if (c.max < 32) continue

      // 高亮块（如白色文字）降权——避免单点过亮抢戏
      const isNearWhite = c.lum > 220 && c.max - c.min < 30
      if (isNearWhite) continue

      // 全局压暗保持"沉郁环境光"基调
      const r = Math.round(c.r * dim)
      const g = Math.round(c.g * dim)
      const b = Math.round(c.b * dim)

      const cx = ((gx + 0.5) / gridX) * 100
      const cy = ((gy + 0.5) / gridY) * 100
      // 圆形 radial：中心实色 → 60% 半径透明。半径 60% 保证相邻焦点有显著重叠区
      radials.push(
        `radial-gradient(circle at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, rgb(${r},${g},${b}) 0%, rgba(${r},${g},${b},0) 60%)`,
      )
    }
  }

  // base 色：整图平均 × 同样的 dim 因子，遮住 radial 透明处
  const baseR = Math.round(avgR * dim)
  const baseG = Math.round(avgG * dim)
  const baseB = Math.round(avgB * dim)

    // 多个 background-image 用逗号拼接；CSS 规则是"首个列在最上层、最后列在最下层"。
    // 我们要 radial 在上、base 在下 → radials 放最前，base linear 放最后。
    return `${radials.join(', ')}, linear-gradient(rgb(${baseR},${baseG},${baseB}), rgb(${baseR},${baseG},${baseB}))`
  } finally {
    bitmap.close()
  }
}
