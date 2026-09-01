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
        r = Math.round(r / n)
        g = Math.round(g / n)
        b = Math.round(b / n)

        // 接近黑色的色块跳过：避免给本就暗的画面引入过多无意义黑色焦点
        if (Math.max(r, g, b) < 32) continue

        // 高亮块（如白色文字）降权——避免单点过亮抢戏
        const min = Math.min(r, g, b)
        const max = Math.max(r, g, b)
        const lum = (r + g + b) / 3
        const isNearWhite = lum > 220 && max - min < 30
        if (isNearWhite) continue

        const cx = ((gx + 0.5) / gridX) * 100
        const cy = ((gy + 0.5) / gridY) * 100
        // 圆形 radial：中心实色 → 60% 半径透明。半径 60% 保证相邻焦点有显著重叠区
        radials.push(
          `radial-gradient(circle at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, rgb(${r},${g},${b}) 0%, rgba(${r},${g},${b},0) 60%)`,
        )
      }
    }

    // 整张图平均色：作为最底层 base，遮住 radial 透明处，防止露出深色背景导致"洞"
    let R = 0,
      G = 0,
      B = 0,
      N = 0
    for (let i = 0; i < W * H; i++) {
      R += data[i * 4]
      G += data[i * 4 + 1]
      B += data[i * 4 + 2]
      N++
    }
    R = Math.round(R / N)
    G = Math.round(G / N)
    B = Math.round(B / N)
    // 整体压暗 12%：环境光应在深色基调上叠加，避免太亮盖住歌词可读性
    const baseR = Math.round(R * 0.88)
    const baseG = Math.round(G * 0.88)
    const baseB = Math.round(B * 0.88)

    // 多个 background-image 用逗号拼接；CSS 规则是"首个列在最上层、最后列在最下层"。
    // 我们要 radial 在上、base 在下 → radials 放最前，base linear 放最后。
    return `${radials.join(', ')}, linear-gradient(rgb(${baseR},${baseG},${baseB}), rgb(${baseR},${baseG},${baseB}))`
  } finally {
    bitmap.close()
  }
}
